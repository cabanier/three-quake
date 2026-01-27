/**
 * BSPCollision - BSP tree collision detection
 *
 * Implements hull tracing through the BSP tree for collision detection.
 * Based on SV_RecursiveHullCheck from Quake source.
 */

// Content types
export const CONTENTS = {
    EMPTY: -1,
    SOLID: -2,
    WATER: -3,
    SLIME: -4,
    LAVA: -5,
    SKY: -6
};

export class BSPCollision {
    constructor(bsp) {
        this.bsp = bsp;
    }

    /**
     * Trace a line through the BSP tree
     * @param {Object} start - Start position {x, y, z}
     * @param {Object} end - End position {x, y, z}
     * @param {Object} hull - Hull size {mins: {x,y,z}, maxs: {x,y,z}}
     * @returns {Object} Trace result
     */
    trace(start, end, hull) {
        const trace = {
            allsolid: true,    // Start as true, set to false when we find non-solid
            startsolid: false,
            inopen: false,
            inwater: false,
            fraction: 1.0,
            endpos: { ...end },
            plane: null,
            contents: CONTENTS.EMPTY
        };

        // Get the appropriate hull (0 = point, 1 = player, 2 = large)
        const hullIndex = this.getHullIndex(hull);
        const model = this.bsp.models[0];
        const headnode = model.headnode[hullIndex];

        // Validate headnode
        const maxNode = hullIndex === 0 ? this.bsp.nodes.length : this.bsp.clipnodes.length;
        if (headnode < 0 || headnode >= maxNode) {
            console.error(`Invalid headnode ${headnode} for hull ${hullIndex} (max: ${maxNode})`);
            return trace;
        }

        // Perform recursive trace
        this.recursiveHullCheck(headnode, 0, 1, start, end, trace, hullIndex);

        // Fix trace (from original Quake world.c)
        // If allsolid is still true, mark as starting solid
        if (trace.allsolid) {
            trace.startsolid = true;
        }
        // If we started in solid, don't allow movement into solid
        if (trace.startsolid) {
            trace.fraction = 0;
        }

        // Calculate end position
        if (trace.fraction === 1.0) {
            trace.endpos = { ...end };
        } else {
            trace.endpos = {
                x: start.x + trace.fraction * (end.x - start.x),
                y: start.y + trace.fraction * (end.y - start.y),
                z: start.z + trace.fraction * (end.z - start.z)
            };
        }

        return trace;
    }

    getHullIndex(hull) {
        // Determine hull based on size (matching original Quake's SV_HullForEntity)
        // Hull 0: point (0x0x0)
        // Hull 1: player (32x32x56) - mins (-16,-16,-24), maxs (16,16,32)
        // Hull 2: large (64x64x88) - shambler sized
        //
        // Original Quake logic from world.c:
        // if (mins == vec3_origin && maxs == vec3_origin) -> hull 0
        // else if (mins[0] == -16) -> hull 1
        // else -> hull 2

        if (hull.mins.x === 0 && hull.mins.y === 0 && hull.mins.z === 0 &&
            hull.maxs.x === 0 && hull.maxs.y === 0 && hull.maxs.z === 0) {
            return 0; // Point hull
        } else if (hull.mins.x === -16) {
            return 1; // Player hull
        } else {
            return 2; // Large hull
        }
    }

    recursiveHullCheck(num, p1f, p2f, p1, p2, trace, hullIndex) {
        const nodeArray = hullIndex === 0 ? this.bsp.nodes : this.bsp.clipnodes;
        const DIST_EPSILON = 0.03125;

        // Iterate when both endpoints are on the same side of a plane
        // (converts tail recursion to iteration - required for JS which lacks TCO)
        while (num >= 0) {
            const node = nodeArray[num];
            const plane = this.bsp.planes[node.planeNum];

            // Calculate distances to plane
            let t1, t2;
            if (plane.type < 3) {
                const axis = ['x', 'y', 'z'][plane.type];
                t1 = p1[axis] - plane.dist;
                t2 = p2[axis] - plane.dist;
            } else {
                t1 = this.dotProduct(plane.normal, p1) - plane.dist;
                t2 = this.dotProduct(plane.normal, p2) - plane.dist;
            }

            // Both points on same side? Continue iteration instead of recursion
            if (t1 >= 0 && t2 >= 0) {
                num = node.children[0];
                continue;
            }
            if (t1 < 0 && t2 < 0) {
                num = node.children[1];
                continue;
            }

            // Points are on opposite sides - need to split
            let frac;
            let side;

            if (t1 < 0) {
                frac = (t1 + DIST_EPSILON) / (t1 - t2);
                side = 1;
            } else {
                frac = (t1 - DIST_EPSILON) / (t1 - t2);
                side = 0;
            }

            frac = Math.max(0, Math.min(1, frac));

            // Calculate midpoint
            const midf = p1f + (p2f - p1f) * frac;
            const mid = {
                x: p1.x + frac * (p2.x - p1.x),
                y: p1.y + frac * (p2.y - p1.y),
                z: p1.z + frac * (p2.z - p1.z)
            };

            // Check front side (must recurse here)
            if (!this.recursiveHullCheck(node.children[side], p1f, midf, p1, mid, trace, hullIndex)) {
                return false;
            }

            // Check if back side is solid
            if (this.hullPointContents(node.children[1 - side], mid, hullIndex) !== CONTENTS.SOLID) {
                // Continue through back side - update variables and iterate
                num = node.children[1 - side];
                p1f = midf;
                p1 = mid;
                continue;
            }

            // Hit solid - never got out of the solid area
            if (trace.allsolid) {
                return false;
            }

            // The other side of the node is solid, this is the impact point
            if (side === 0) {
                trace.plane = {
                    normal: { ...plane.normal },
                    dist: plane.dist
                };
            } else {
                trace.plane = {
                    normal: {
                        x: -plane.normal.x,
                        y: -plane.normal.y,
                        z: -plane.normal.z
                    },
                    dist: -plane.dist
                };
            }

            // Find actual intersection point (back up if in solid)
            while (this.hullPointContents(this.bsp.models[0].headnode[hullIndex], mid, hullIndex) === CONTENTS.SOLID) {
                frac -= 0.1;
                if (frac < 0) {
                    trace.fraction = midf;
                    return false;
                }
                mid.x = p1.x + frac * (p2.x - p1.x);
                mid.y = p1.y + frac * (p2.y - p1.y);
                mid.z = p1.z + frac * (p2.z - p1.z);
            }

            trace.fraction = p1f + (p2f - p1f) * frac;
            return false;
        }

        // Reached a leaf (num < 0)
        let contents;
        if (hullIndex === 0) {
            contents = this.getLeafContents(num);
        } else {
            contents = num; // Clipnode contents are the value itself
        }

        if (contents === CONTENTS.SOLID) {
            trace.startsolid = true;
        } else {
            trace.allsolid = false;
            if (contents === CONTENTS.EMPTY) {
                trace.inopen = true;
            } else if (contents <= CONTENTS.WATER) {
                trace.inwater = true;
            }
        }

        return true;
    }

    hullPointContents(nodeIndex, point, hullIndex) {
        while (nodeIndex >= 0) {
            const node = hullIndex === 0
                ? this.bsp.nodes[nodeIndex]
                : this.bsp.clipnodes[nodeIndex];

            const plane = this.bsp.planes[node.planeNum];

            let d;
            if (plane.type < 3) {
                d = point[['x', 'y', 'z'][plane.type]] - plane.dist;
            } else {
                d = this.dotProduct(plane.normal, point) - plane.dist;
            }

            if (d < 0) {
                nodeIndex = node.children[1];
            } else {
                nodeIndex = node.children[0];
            }
        }

        // For clipnodes (hull 1,2), negative values ARE the contents directly
        // For nodes (hull 0), negative values are -(leaf+1) indices
        if (hullIndex === 0) {
            return this.getLeafContents(nodeIndex);
        } else {
            // Clipnode contents: negative value IS the content type
            return nodeIndex;
        }
    }

    getLeafContents(leafIndex) {
        // For hull 0 (nodes), leaf indices are -(leaf+1)
        // So -1 = leaf 0, -2 = leaf 1, etc.
        const actualIndex = -(leafIndex + 1);
        if (actualIndex >= 0 && actualIndex < this.bsp.leafs.length) {
            return this.bsp.leafs[actualIndex].contents;
        }

        return CONTENTS.SOLID;
    }

    pointContents(point) {
        return this.hullPointContents(this.bsp.models[0].headnode[0], point, 0);
    }

    /**
     * Find the BSP leaf containing a point
     * Original: Mod_PointInLeaf from model.c
     *
     * @param {Object} point - Point position {x, y, z}
     * @returns {Object|null} The leaf object containing the point, or null
     */
    pointInLeaf(point) {
        if (!this.bsp.nodes || this.bsp.nodes.length === 0) {
            return null;
        }

        // Start at model 0 (world) headnode for hull 0
        let nodeIndex = this.bsp.models[0].headnode[0];

        // Traverse BSP tree until we reach a leaf (negative index)
        while (nodeIndex >= 0) {
            const node = this.bsp.nodes[nodeIndex];
            const plane = this.bsp.planes[node.planeNum];

            let d;
            if (plane.type < 3) {
                // Axial plane - use direct axis comparison
                d = point[['x', 'y', 'z'][plane.type]] - plane.dist;
            } else {
                // Non-axial plane - use dot product
                d = this.dotProduct(plane.normal, point) - plane.dist;
            }

            if (d >= 0) {
                nodeIndex = node.children[0];  // Front
            } else {
                nodeIndex = node.children[1];  // Back
            }
        }

        // Convert negative leaf index to actual leaf
        // Leaf indices are -(leaf+1), so -1 = leaf 0, -2 = leaf 1, etc.
        const leafIndex = -(nodeIndex + 1);
        if (leafIndex >= 0 && leafIndex < this.bsp.leafs.length) {
            return this.bsp.leafs[leafIndex];
        }

        return null;
    }

    /**
     * Get ambient sound levels for a point
     * Uses pointInLeaf to find the leaf and returns its ambient_level array
     *
     * @param {Object} point - Point position {x, y, z}
     * @returns {number[]} Array of 4 ambient levels (0-255), or [0,0,0,0] if not found
     */
    getAmbientLevels(point) {
        const leaf = this.pointInLeaf(point);
        if (leaf && leaf.ambientLevel) {
            return leaf.ambientLevel;
        }
        return [0, 0, 0, 0];
    }

    dotProduct(v1, v2) {
        return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    }
}
