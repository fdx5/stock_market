import { BoundedCache } from './BoundedCache.js';
export function preprocess( code, defines = {} ) {

	const lines = code.split( '\n' );
	const out = [];
	// stack of { active, taken, parentActive }
	const stack = [];
	const active = () => stack.length === 0 || stack[ stack.length - 1 ].active;
	const evalCond = ( expr ) => {

		expr = expr.trim();
		let m;
		if ( ( m = /^!\s*(\w+)$/.exec( expr ) ) ) return ! truthy( defines[ m[ 1 ] ] );
		if ( ( m = /^(\w+)\s*(==|!=|>=|<=|>|<)\s*([\w.'"-]+)$/.exec( expr ) ) ) {

			const a = defines[ m[ 1 ] ];
			let b = m[ 3 ].replace( /^['"]|['"]$/g, '' );
			if ( ! isNaN( Number( b ) ) && typeof a === 'number' ) b = Number( b );
			switch ( m[ 2 ] ) {

				case '==': return a == b; // eslint-disable-line eqeqeq
				case '!=': return a != b; // eslint-disable-line eqeqeq
				case '>=': return a >= b;
				case '<=': return a <= b;
				case '>': return a > b;
				case '<': return a < b;

			}

		}

		if ( /\|\|/.test( expr ) ) return expr.split( '||' ).some( ( e ) => evalCond( e ) );
		if ( /&&/.test( expr ) ) return expr.split( '&&' ).every( ( e ) => evalCond( e ) );
		return truthy( defines[ expr ] );

	};

	for ( const line of lines ) {

		const t = line.trim();
		let m;
		if ( ( m = /^#(if|ifdef|ifndef)\s+(.*)$/.exec( t ) ) ) {

			const parent = active();
			let c;
			if ( m[ 1 ] === 'ifdef' ) c = defines[ m[ 2 ].trim() ] !== undefined;
			else if ( m[ 1 ] === 'ifndef' ) c = defines[ m[ 2 ].trim() ] === undefined;
			else c = evalCond( m[ 2 ] );
			stack.push( { active: parent && c, taken: c, parent } );
			continue;

		}

		if ( ( m = /^#elif\s+(.*)$/.exec( t ) ) ) {

			const s = stack[ stack.length - 1 ];
			const c = ! s.taken && evalCond( m[ 1 ] );
			s.active = s.parent && c;
			s.taken = s.taken || c;
			continue;

		}

		if ( t === '#else' ) {

			const s = stack[ stack.length - 1 ];
			s.active = s.parent && ! s.taken;
			s.taken = true;
			continue;

		}

		if ( t === '#endif' ) {

			stack.pop();
			continue;

		}

		if ( active() ) out.push( line );

	}

	if ( stack.length ) throw new Error( 'preprocess: unterminated #if' );
	return out.join( '\n' );

}

function truthy( v ) {

	return v !== undefined && v !== null && v !== false && v !== 0 && v !== '0';

}

export function reachableIdentifiers( code, entry ) {

	const fns = new Map();
	const re = /\bfn\s+([A-Za-z_]\w*)\s*\(/g;
	let m;
	while ( ( m = re.exec( code ) ) ) {

		const open = code.indexOf( '{', m.index );
		if ( open < 0 ) break;
		let depth = 0, i = open;
		for ( ; i < code.length; i ++ ) {

			const c = code[ i ];
			if ( c === '{' ) depth ++;
			else if ( c === '}' && -- depth === 0 ) break;

		}

		// entry points are never called (a local variable named like one must not pull it in)
		const isEntry = /@(vertex|fragment|compute)[^;{}]*$/.test( code.slice( Math.max( 0, m.index - 80 ), m.index ) );
		if ( ! isEntry || m[ 1 ] === entry ) fns.set( m[ 1 ], code.slice( m.index, i + 1 ) );
		re.lastIndex = i + 1;

	}

	const used = new Set();
	const queue = [ entry ];
	const seen = new Set();
	while ( queue.length ) {

		const f = queue.pop();
		if ( seen.has( f ) || ! fns.has( f ) ) continue;
		seen.add( f );
		for ( const id of fns.get( f ).match( /[A-Za-z_]\w*/g ) || [] ) {

			used.add( id );
			if ( fns.has( id ) && ! seen.has( id ) ) queue.push( id );

		}

	}

	return used;

}

const _stripped = new BoundedCache(128, 2 * 1024 * 1024);
export function stripUnusedFunctions( code ) {

	const hit = _stripped.get( code );
	if ( hit !== undefined ) return hit;
	const src = code.replace( /\/\*[\s\S]*?\*\//g, '' ).replace( /\/\/[^\n]*/g, '' );
	// top-level declarations: [start, end) spans, split where a block or a ';' closes at depth 0
	const decls = [];
	let depth = 0, start = 0, paren = 0;
	for ( let i = 0; i < src.length; i ++ ) {

		const c = src[ i ];
		if ( c === '(' ) paren ++;
		else if ( c === ')' ) paren --;
		else if ( c === '{' ) depth ++;
		else if ( c === '}' ) { depth --; if ( depth === 0 && paren === 0 ) {

			// (a struct's closing brace may be followed by a ';')
			let j = i + 1; while ( j < src.length && /\s/.test( src[ j ] ) ) j ++;
			if ( src[ j ] === ';' ) i = j;
			decls.push( [ start, i + 1 ] ); start = i + 1;

		} }
		else if ( c === ';' && depth === 0 && paren === 0 ) { decls.push( [ start, i + 1 ] ); start = i + 1; }

	}
	if ( depth !== 0 ) { _stripped.set( code, code ); return code; }
	const tail = src.slice( start );
const fns = new Map(), roots = [];
	for ( const [ a, b ] of decls ) {

		const text = src.slice( a, b ), m = /\bfn\s+([A-Za-z_]\w*)\s*\(/.exec( text );
		if ( m && /^[\s\S]*?\bfn\b/.exec( text )[ 0 ].indexOf( '{' ) < 0 ) {

			fns.set( m[ 1 ], { text, entry: /@(vertex|fragment|compute)\b/.test( text.slice( 0, m.index ) ) } );

		} else {

			// Resource declarations, structs and constants can carry large unused library
			// graphs too. Follow their references exactly as functions, retaining directives
			// (enable/requires/diagnostic/const_assert) as unconditional roots.
			const declaration = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:struct|alias|const|override|var(?:\s*<[^>]*>)?)\s+([A-Za-z_]\w*)\b/.exec( text );
			if ( declaration ) fns.set( declaration[ 1 ], { text, entry: false } );
			else roots.push( text );

		}

	}
	if ( ! fns.size ) { _stripped.set( code, code ); return code; }
	const used = new Set(), stack = [];
	const scan = ( text ) => { for ( const id of text.match( /[A-Za-z_]\w*/g ) || [] ) if ( fns.has( id ) && ! used.has( id ) ) { used.add( id ); stack.push( id ); } };
	for ( const [ name, f ] of fns ) if ( f.entry && ! used.has( name ) ) { used.add( name ); stack.push( name ); }
	roots.forEach( scan ); scan( tail );
	while ( stack.length ) scan( fns.get( stack.pop() ).text );
	let out = '';
	for ( const [ a, b ] of decls ) {

		const text = src.slice( a, b );
		const m = /\bfn\s+([A-Za-z_]\w*)\s*\(/.exec( text )
			|| /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:struct|alias|const|override|var(?:\s*<[^>]*>)?)\s+([A-Za-z_]\w*)\b/.exec( text );
		if ( m && fns.get( m[ 1 ] )?.text === text && ! used.has( m[ 1 ] ) ) continue;
		out += text;

	}
	out += tail;
	_stripped.set( code, out );
	if ( _stripped.size > 256 ) _stripped.delete( _stripped.keys().next().value );
	return out;

}
