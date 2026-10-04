//! Only broad-phase BVH construction. Exact Three.js road/paint maths stay in JS.
use std::slice;

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Node { bounds: [f32; 4], left: u32, right: u32, start: u32, count: u32 }
pub struct Tree { nodes: Vec<Node>, ids: Vec<u32> }

fn split(bounds: &[[f32; 4]], ids: &mut [u32], start: usize, nodes: &mut Vec<Node>) -> u32 {
    let mut b = [f32::INFINITY, f32::INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY];
    for &id in ids.iter() { let q = bounds[id as usize];
        b[0] = b[0].min(q[0]); b[1] = b[1].min(q[1]); b[2] = b[2].max(q[2]); b[3] = b[3].max(q[3]);
    }
    let at = nodes.len() as u32;
    nodes.push(Node { bounds: b, start: start as u32, count: ids.len() as u32, ..Node::default() });
    if ids.len() > 8 {
        let axis = if b[2] - b[0] >= b[3] - b[1] { 0 } else { 1 };
        let middle = ids.len() / 2;
        ids.select_nth_unstable_by(middle, |a, c| {
            let a = bounds[*a as usize]; let c = bounds[*c as usize];
            (a[axis] + a[axis + 2]).total_cmp(&(c[axis] + c[axis + 2]))
        });
        let (a, c) = ids.split_at_mut(middle);
        let left = split(bounds, a, start, nodes);
        let right = split(bounds, c, start + middle, nodes);
        nodes[at as usize].left = left; nodes[at as usize].right = right; nodes[at as usize].count = 0;
    }
    at
}

// u32 allocations are also aligned for f32 bounds. Lengths are in 32-bit words.
#[no_mangle]
pub extern "C" fn alloc_words(len: usize) -> *mut u32 {
    Box::into_raw(vec![0u32; len].into_boxed_slice()) as *mut u32
}
#[no_mangle]
pub unsafe extern "C" fn free_words(ptr: *mut u32, len: usize) {
    drop(Box::from_raw(slice::from_raw_parts_mut(ptr, len)));
}
#[no_mangle]
pub unsafe extern "C" fn bvh_build(ptr: *const f32, count: usize) -> *mut Tree {
    if count == 0 || count > 2_000_000 { return std::ptr::null_mut(); }
    let bounds = slice::from_raw_parts(ptr as *const [f32; 4], count);
    if bounds.iter().any(|b| b.iter().any(|v| !v.is_finite()) || b[0] > b[2] || b[1] > b[3]) { return std::ptr::null_mut(); }
    let mut tree = Tree { nodes: Vec::with_capacity(count / 2 + 1), ids: (0..count as u32).collect() };
    split(bounds, &mut tree.ids, 0, &mut tree.nodes);
    Box::into_raw(Box::new(tree))
}
#[no_mangle]
pub unsafe extern "C" fn bvh_nodes(ptr: *const Tree) -> *const Node { (*ptr).nodes.as_ptr() }
#[no_mangle]
pub unsafe extern "C" fn bvh_node_count(ptr: *const Tree) -> usize { (*ptr).nodes.len() }
#[no_mangle]
pub unsafe extern "C" fn bvh_ids(ptr: *const Tree) -> *const u32 { (*ptr).ids.as_ptr() }
#[no_mangle]
pub unsafe extern "C" fn bvh_free(ptr: *mut Tree) { drop(Box::from_raw(ptr)); }
