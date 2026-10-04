/** The carriageway width itself determines a major approach. Comparing it with
 * the widest boulevard incorrectly removed signals from ordinary 2–4 lane roads. */
export function junctionSignalPolicy(arms:readonly {key:string;width:number}[]){
 const minor=new Set(arms.filter(a=>a.width<8).map(a=>a.key));
 const majors=arms.length-minor.size;
 return {minor,majors,signal:arms.length>=3&&majors>=3};
}

/** Admission reserves the box immediately, including red-light right turns.
 * The next candidate in this simulation tick must observe that reservation. */
export function junctionOccupied<T>(occupants:readonly T[],self:T,approach:string,of:(o:T)=>string|undefined,phase:(key:string)=>string|number|undefined){
 const group=phase(approach);
 return occupants.some(o=>o!==self&&phase(of(o)??'')!==group);
}
