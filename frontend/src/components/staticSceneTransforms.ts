import type {Object3D} from 'three';

/** Only for scenery whose local transforms are complete: buildings, terrain and
 * plant batches. Instance matrices, LOD geometry and visibility remain mutable.
 * A moving parent still propagates its world transform normally. */
export function staticSceneTransforms(root:Object3D){
 root.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});
}
