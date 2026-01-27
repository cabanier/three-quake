import { WEAPON, IT } from '../entities/Player.js';
import { alertNearbyMonsters } from '../entities/Monster.js';

/**
 * Weapons - Weapon behavior and projectile creation
 */

// Weapon data
export const WEAPONS = {
    [WEAPON.AXE]: {
        name: 'Axe',
        model: 'progs/v_axe.mdl',
        sound: 'weapons/ax1.wav',
        damage: 20,
        rate: 0.5,
        ammoType: null,
        ammoUse: 0
    },
    [WEAPON.SHOTGUN]: {
        name: 'Shotgun',
        model: 'progs/v_shot.mdl',
        sound: 'weapons/guncock.wav',
        damage: 4, // per pellet, 6 pellets
        rate: 0.5,
        ammoType: 'shells',
        ammoUse: 1
    },
    [WEAPON.SUPER_SHOTGUN]: {
        name: 'Super Shotgun',
        model: 'progs/v_shot2.mdl',
        sound: 'weapons/shotgn2.wav',
        damage: 4, // per pellet, 14 pellets
        rate: 0.7,
        ammoType: 'shells',
        ammoUse: 2
    },
    [WEAPON.NAILGUN]: {
        name: 'Nailgun',
        model: 'progs/v_nail.mdl',
        sound: 'weapons/rocket1i.wav',
        damage: 9,
        rate: 0.1,
        ammoType: 'nails',
        ammoUse: 1
    },
    [WEAPON.SUPER_NAILGUN]: {
        name: 'Super Nailgun',
        model: 'progs/v_nail2.mdl',
        sound: 'weapons/spike2.wav',
        damage: 18,
        rate: 0.2,  // Original Quake: attack_finished = time + 0.2 (fires 2 nails)
        ammoType: 'nails',
        ammoUse: 2
    },
    [WEAPON.GRENADE_LAUNCHER]: {
        name: 'Grenade Launcher',
        model: 'progs/v_rock.mdl',
        sound: 'weapons/grenade.wav',
        damage: 100,
        splashDamage: 120,
        splashRadius: 160,
        rate: 0.6,
        ammoType: 'rockets',
        ammoUse: 1
    },
    [WEAPON.ROCKET_LAUNCHER]: {
        name: 'Rocket Launcher',
        model: 'progs/v_rock2.mdl',
        sound: 'weapons/sgun1.wav',
        damage: 100,
        splashDamage: 120,
        splashRadius: 160,
        rate: 0.8,
        ammoType: 'rockets',
        ammoUse: 1
    },
    [WEAPON.LIGHTNING]: {
        name: 'Lightning Gun',
        model: 'progs/v_light.mdl',
        sound: 'weapons/lhit.wav',
        damage: 30,
        rate: 0.1,       // 10 ticks/sec like original Quake
        ammoType: 'cells',
        ammoUse: 1,
        continuous: true // Fires continuously while held
    }
};

export function canFire(player, game) {
    if (game.time < player.attackFinished) {
        return false;
    }

    const weapon = WEAPONS[player.currentWeapon];
    if (!weapon) return false;

    // Check ammo
    if (weapon.ammoType) {
        if (player.ammo[weapon.ammoType] < weapon.ammoUse) {
            // Switch to a weapon with ammo
            selectBestWeapon(player);
            return false;
        }
    }

    return true;
}

/**
 * Check if current weapon fires continuously while held (like Lightning Gun)
 */
export function isContinuousWeapon(player) {
    const weapon = WEAPONS[player.currentWeapon];
    return weapon && weapon.continuous === true;
}

export function fireWeapon(player, game) {
    if (!canFire(player, game)) return;

    const weapon = WEAPONS[player.currentWeapon];
    console.log(`Firing ${weapon.name}`);

    // Consume ammo
    if (weapon.ammoType) {
        player.ammo[weapon.ammoType] -= weapon.ammoUse;
    }

    // Set attack cooldown
    player.attackFinished = game.time + weapon.rate;

    // Play sound
    if (weapon.sound && game.audio) {
        game.audio.playLocal(`sound/${weapon.sound}`);
    }

    // Muzzle flash for ranged weapons
    if (player.currentWeapon !== WEAPON.AXE && game.effects) {
        const forward = getForwardVector(player);
        const muzzlePos = {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z + 22
        };
        game.effects.muzzleFlash(muzzlePos, forward);
    }

    // Alert nearby monsters (hearing system)
    // Different weapons have different alert ranges based on loudness
    let alertRange = 1000;
    if (player.currentWeapon === WEAPON.AXE) {
        alertRange = 200;  // Melee is quiet
    } else if (player.currentWeapon === WEAPON.NAILGUN || player.currentWeapon === WEAPON.SUPER_NAILGUN) {
        alertRange = 800;  // Nailguns are relatively quiet
    } else if (player.currentWeapon === WEAPON.ROCKET_LAUNCHER || player.currentWeapon === WEAPON.GRENADE_LAUNCHER) {
        alertRange = 1500;  // Explosives are LOUD
    } else if (player.currentWeapon === WEAPON.LIGHTNING) {
        alertRange = 1200;  // Lightning is distinctive
    }
    alertNearbyMonsters(game, player.position, player, alertRange);

    // Fire based on weapon type and apply punch angle (camera recoil)
    // Punch angle values from original Quake weapons.qc (negative = kick up)
    // Decay is handled by Renderer.update() with exponential falloff
    let punchPitch = 0;
    switch (player.currentWeapon) {
        case WEAPON.AXE:
            fireAxe(player, game);
            // Original Quake: axe has NO punchangle
            punchPitch = 0;
            break;
        case WEAPON.SHOTGUN:
            fireShotgun(player, game, 6);
            punchPitch = -2; // Quake: punchangle_x = -2
            break;
        case WEAPON.SUPER_SHOTGUN:
            // Original Quake: if only 1 shell, fire regular shotgun instead
            if (player.ammo.shells === 1) {
                // Refund the extra shell we consumed
                player.ammo.shells += 1;
                fireShotgun(player, game, 6);
                punchPitch = -2;
            } else {
                fireShotgun(player, game, 14);
                punchPitch = -4; // Quake: punchangle_x = -4
            }
            break;
        case WEAPON.NAILGUN:
            fireNail(player, game);
            punchPitch = -2; // Quake: punchangle_x = -2 (W_FireSpikes line 683)
            break;
        case WEAPON.SUPER_NAILGUN:
            fireNail(player, game);
            punchPitch = -2; // Quake: punchangle_x = -2 (W_FireSuperSpikes line 654)
            break;
        case WEAPON.GRENADE_LAUNCHER:
            fireGrenade(player, game);
            punchPitch = -2; // Quake: punchangle_x = -2
            break;
        case WEAPON.ROCKET_LAUNCHER:
            fireRocket(player, game);
            punchPitch = -2; // Quake: punchangle_x = -2 (W_FireRocket line 399)
            break;
        case WEAPON.LIGHTNING:
            fireLightning(player, game);
            punchPitch = -2; // Quake: punchangle_x = -2 (W_FireLightning line 506)
            break;
    }

    // Apply punch angle to renderer (if available)
    if (game.renderer && punchPitch !== 0) {
        game.renderer.setPunchAngle(punchPitch);
    }
}

function fireAxe(player, game) {
    // Melee attack - trace forward
    // Original Quake: source = self.origin + '0 0 16'
    const forward = getForwardVector(player);
    const start = { ...player.position };
    start.z += 16; // Original Quake uses +16, not eye level

    const end = {
        x: start.x + forward.x * 64,
        y: start.y + forward.y * 64,
        z: start.z + forward.z * 64
    };

    const trace = traceHitscan(start, end, player, game);

    // Original Quake: if (trace_fraction == 1.0) return; - miss if no hit
    if (!trace.hit) {
        return;
    }

    const damage = WEAPONS[WEAPON.AXE].damage;
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;

    if (trace.entity) {
        // Hit entity - deal damage and spawn blood
        game.dealDamage(trace.entity, damage * quadMult, player);
        if (game.effects) {
            game.effects.blood(trace.endpos, 20); // Original: SpawnBlood(org, '0 0 0', 20)
        }
    } else {
        // Hit wall - play axhit2.wav and spawn gunshot particles
        // Original Quake: sound(self, CHAN_WEAPON, "player/axhit2.wav", 1, ATTN_NORM)
        if (game.audio) {
            game.audio.playLocal('sound/player/axhit2.wav');
        }
        if (game.effects) {
            game.effects.impact(trace.endpos, trace.plane?.normal);
        }
    }
}

function fireShotgun(player, game, pellets) {
    const forward = getForwardVector(player);
    const right = getRightVector(player);
    const up = { x: 0, y: 0, z: 1 };

    const start = { ...player.position };
    start.z += 22;

    const damage = WEAPONS[WEAPON.SHOTGUN].damage;
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;

    // Original Quake spread values:
    // Shotgun: 0.04 horizontal, 0.04 vertical
    // Super Shotgun: 0.14 horizontal, 0.08 vertical
    const isSuper = pellets > 6;
    const spreadH = isSuper ? 0.14 : 0.04;
    const spreadV = isSuper ? 0.08 : 0.04;

    // Fire multiple pellets with spread
    for (let i = 0; i < pellets; i++) {
        // Random spread using crandom() style (-1 to 1) like original Quake
        const spreadX = (Math.random() * 2 - 1) * spreadH;
        const spreadY = (Math.random() * 2 - 1) * spreadV;

        const dir = {
            x: forward.x + right.x * spreadX + up.x * spreadY,
            y: forward.y + right.y * spreadX + up.y * spreadY,
            z: forward.z + right.z * spreadX + up.z * spreadY
        };

        // Normalize
        const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
        dir.x /= len;
        dir.y /= len;
        dir.z /= len;

        const end = {
            x: start.x + dir.x * 2048,
            y: start.y + dir.y * 2048,
            z: start.z + dir.z * 2048
        };

        const trace = traceHitscan(start, end, player, game);
        if (trace.hit) {
            if (trace.entity) {
                // Hit an entity
                game.dealDamage(trace.entity, damage * quadMult, player);
                if (game.effects) {
                    game.effects.blood(trace.endpos);
                }
            } else {
                // Hit world
                if (game.effects) {
                    game.effects.impact(trace.endpos, trace.plane?.normal);
                }
                // Play ricochet sound (only for first few pellets to avoid sound spam)
                if (game.audio && i < 3) {
                    const ricSounds = ['sound/weapons/ric1.wav', 'sound/weapons/ric2.wav', 'sound/weapons/ric3.wav'];
                    game.audio.playPositioned(ricSounds[Math.floor(Math.random() * ricSounds.length)], trace.endpos, 0.3);
                }
            }
        }
    }
}

// Nailgun barrel alternation state (original Quake alternates between left/right)
let nailBarrelOffset = 4;

function fireNail(player, game) {
    const forward = getForwardVector(player);
    const right = getRightVector(player);

    // Create nail projectile
    const projectile = game.entities.spawn();
    if (!projectile) return;

    projectile.classname = 'nail';
    projectile.category = 'projectile';
    projectile.moveType = 'fly';
    projectile.solid = 'bbox';

    const speed = 1000;
    projectile.velocity = {
        x: forward.x * speed,
        y: forward.y * speed,
        z: forward.z * speed
    };

    // Original Quake: launch_spike(self.origin + '0 0 16' + v_right*ox, dir)
    // ox alternates between 4 and -4 for barrel offset
    projectile.position = {
        x: player.position.x + right.x * nailBarrelOffset,
        y: player.position.y + right.y * nailBarrelOffset,
        z: player.position.z + 16  // Original uses +16
    };

    // Alternate barrel for next shot
    nailBarrelOffset = -nailBarrelOffset;

    const damage = WEAPONS[player.currentWeapon].damage;
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;
    projectile.data.damage = damage * quadMult;
    projectile.data.owner = player;
    projectile.data.isSuper = player.currentWeapon === WEAPON.SUPER_NAILGUN;
    projectile.data.spawnTime = game.time;
    projectile.data.lifetime = 6.0;  // Original Quake: nextthink = time + 6 (SUB_Remove)

    projectile.think = nailThink;
    projectile.nextThink = game.time + 0.05;
    projectile.touch = nailTouch;

    // Attach visual sprite (nails are small yellow)
    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, projectile.data.isSuper ? 'super_nail' : 'nail');
    }

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);
}

function nailThink(nail, game) {
    // Check for timeout (original Quake: nextthink = time + 6, think = SUB_Remove)
    if (game.time >= nail.data.spawnTime + nail.data.lifetime) {
        // Clean up visual
        if (game.effects) {
            game.effects.removeProjectileVisual(nail);
        }
        game.entities.remove(nail);
        game.physics.removeEntity(nail);
        return;
    }

    // Update visual sprite position and spawn trail
    if (game.effects) {
        // Nails have a faint trail
        game.effects.trail(nail.position, nail.data.isSuper ? 0xaa88ff : 0xffff00);

        if (nail.updateVisual) {
            nail.updateVisual(nail);
        }
    }

    nail.nextThink = game.time + 0.05;
}

function nailTouch(nail, other, game, trace) {
    // Skip if hit owner
    if (other && other === nail.data.owner) return;

    // Apply damage if hit an entity
    if (other && other.health) {
        game.dealDamage(other, nail.data.damage, nail.data.owner);
        // Blood effect
        if (game.effects && trace?.endpos) {
            game.effects.blood(trace.endpos);
        }
    } else {
        // Wall impact sparks
        if (game.effects && trace?.endpos) {
            game.effects.impact(trace.endpos, trace?.plane?.normal);
        }
    }

    // Clean up visual sprite
    if (game.effects) {
        game.effects.removeProjectileVisual(nail);
    }

    // Remove nail on any hit (wall or entity)
    game.entities.remove(nail);
    game.physics.removeEntity(nail);
}

function fireGrenade(player, game) {
    const forward = getForwardVector(player);
    const right = getRightVector(player);
    const up = { x: 0, y: 0, z: 1 };

    const projectile = game.entities.spawn();
    if (!projectile) return;

    projectile.classname = 'grenade';
    projectile.category = 'projectile';
    projectile.moveType = 'bounce';
    projectile.solid = 'bbox';

    // Original Quake: if looking up/down, add random spread
    // missile.velocity = v_forward*600 + v_up * 200 + crandom()*v_right*10 + crandom()*v_up*10
    const speed = 600;
    const crandomX = (Math.random() * 2 - 1) * 10;  // crandom() * 10
    const crandomZ = (Math.random() * 2 - 1) * 10;  // crandom() * 10

    projectile.velocity = {
        x: forward.x * speed + right.x * crandomX,
        y: forward.y * speed + right.y * crandomX,
        z: forward.z * speed + 200 + crandomZ  // +200 upward boost + random
    };

    // Original Quake: setorigin(missile, self.origin)
    projectile.position = { ...player.position };

    // Original Quake: avelocity = '300 300 300'
    projectile.angles = { pitch: 0, yaw: 0, roll: 0 };
    projectile.angularVelocity = { pitch: 300, yaw: 300, roll: 300 };

    const weapon = WEAPONS[WEAPON.GRENADE_LAUNCHER];
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;
    projectile.data.damage = weapon.splashDamage * quadMult;
    projectile.data.radius = weapon.splashRadius;
    projectile.data.owner = player;
    projectile.data.explodeTime = game.time + 2.5;
    projectile.data.oldOrigin = { ...projectile.position }; // For trail spawning

    projectile.think = grenadeThink;
    projectile.nextThink = game.time + 0.05;
    projectile.touch = grenadeTouch;

    // Attach visual (grenades have darker smoke trail)
    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, 'grenade');
    }

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);
}

function grenadeThink(grenade, game) {
    if (game.time >= grenade.data.explodeTime) {
        // Clean up visual before explosion
        if (game.effects) {
            game.effects.removeProjectileVisual(grenade);
        }
        explode(grenade, game);
        return;
    }

    // Update angular rotation (avelocity = '300 300 300')
    if (grenade.angularVelocity) {
        const dt = 0.05;  // Think interval
        grenade.angles.pitch += grenade.angularVelocity.pitch * dt;
        grenade.angles.yaw += grenade.angularVelocity.yaw * dt;
        grenade.angles.roll += grenade.angularVelocity.roll * dt;

        // Update mesh rotation if it exists
        if (grenade.mesh) {
            grenade.mesh.rotation.x = grenade.angles.pitch * Math.PI / 180;
            grenade.mesh.rotation.y = grenade.angles.roll * Math.PI / 180;
            grenade.mesh.rotation.z = -grenade.angles.yaw * Math.PI / 180;
        }
    }

    // Spawn smoke trail along path from old position to current
    // Original Quake: R_RocketTrail(oldorg, ent->origin, 1)
    if (game.effects && grenade.data.oldOrigin) {
        game.effects.rocketTrail(grenade.data.oldOrigin, grenade.position, 1); // 1 = grenade smoke trail

        // Update old position for next frame
        grenade.data.oldOrigin = { ...grenade.position };

        // Update visual sprite position
        if (grenade.updateVisual) {
            grenade.updateVisual(grenade);
        }
    }

    grenade.nextThink = game.time + 0.05;
}

function grenadeTouch(grenade, other, game, trace) {
    // Skip if hit owner
    if (other && other === grenade.data.owner) return;

    // Explode if hit an entity with health (DAMAGE_AIM)
    // Original: if (other.takedamage == DAMAGE_AIM) { GrenadeExplode(); return; }
    if (other && other.health) {
        // Clean up visual before explosion
        if (game.effects) {
            game.effects.removeProjectileVisual(grenade);
        }
        explode(grenade, game);
        return;
    }

    // Hit wall - play bounce sound
    // Original Quake: sound(self, CHAN_WEAPON, "weapons/bounce.wav", 1, ATTN_NORM)
    if (game.audio) {
        game.audio.playPositioned('sound/weapons/bounce.wav', grenade.position, 1.0, 1.0);
    }

    // Original Quake: if (self.velocity == '0 0 0') self.avelocity = '0 0 0'
    // Stop spinning when velocity is zero (grenade has stopped)
    const velMag = Math.sqrt(
        grenade.velocity.x * grenade.velocity.x +
        grenade.velocity.y * grenade.velocity.y +
        grenade.velocity.z * grenade.velocity.z
    );
    if (velMag < 10) {
        grenade.angularVelocity = { pitch: 0, yaw: 0, roll: 0 };
    }
}

function fireRocket(player, game) {
    const forward = getForwardVector(player);

    const projectile = game.entities.spawn();
    if (!projectile) return;

    projectile.classname = 'rocket';
    projectile.category = 'projectile';
    projectile.moveType = 'fly';
    projectile.solid = 'bbox';

    const speed = 1000;
    projectile.velocity = {
        x: forward.x * speed,
        y: forward.y * speed,
        z: forward.z * speed
    };

    // Original Quake: setorigin(missile, self.origin + v_forward*8 + '0 0 16')
    projectile.position = {
        x: player.position.x + forward.x * 8,
        y: player.position.y + forward.y * 8,
        z: player.position.z + 16
    };

    const weapon = WEAPONS[WEAPON.ROCKET_LAUNCHER];
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;
    projectile.data.directDamage = (100 + Math.random() * 20) * quadMult; // Direct hit damage
    projectile.data.splashDamage = weapon.splashDamage * quadMult;
    projectile.data.radius = weapon.splashRadius;
    projectile.data.owner = player;
    projectile.data.oldOrigin = { ...projectile.position }; // For trail spawning
    projectile.data.spawnTime = game.time;
    projectile.data.lifetime = 5.0;  // Original Quake: nextthink = time + 5 (SUB_Remove)

    projectile.think = rocketThink;
    projectile.nextThink = game.time + 0.05;
    projectile.touch = rocketTouch;

    // Attach visual trail (creates sprite and trail particles)
    if (game.effects) {
        game.effects.attachProjectileTrail(projectile, 'rocket');
    }

    // Add dynamic light to rocket (Quake: 200 radius)
    if (game.effects) {
        projectile.data.light = game.effects.spawnDynamicLight(projectile.position, {
            color: 0xff6600,
            radius: 200,
            duration: 999, // Long duration, we'll remove it on explosion
            decay: 0
        });
    }

    game.entities.addToCategory(projectile);
    game.physics.addEntity(projectile);
}

function rocketThink(rocket, game) {
    // Check for timeout (original Quake: nextthink = time + 5, think = SUB_Remove)
    if (game.time >= rocket.data.spawnTime + rocket.data.lifetime) {
        // Clean up light
        if (rocket.data.light && game.effects) {
            game.effects.scene.remove(rocket.data.light);
            rocket.data.light.dispose();
            const idx = game.effects.dynamicLights.indexOf(rocket.data.light);
            if (idx !== -1) {
                game.effects.dynamicLights.splice(idx, 1);
            }
        }
        // Clean up visual
        if (game.effects) {
            game.effects.removeProjectileVisual(rocket);
        }
        game.entities.remove(rocket);
        game.physics.removeEntity(rocket);
        return;
    }

    // Spawn trail particles along path from old position to current
    // Original Quake: R_RocketTrail(oldorg, ent->origin, 0)
    if (game.effects && rocket.data.oldOrigin) {
        game.effects.rocketTrail(rocket.data.oldOrigin, rocket.position, 0); // 0 = rocket fire trail

        // Update old position for next frame
        rocket.data.oldOrigin = { ...rocket.position };

        // Update attached light position
        if (rocket.data.light) {
            rocket.data.light.position.set(rocket.position.x, rocket.position.y, rocket.position.z);
        }

        // Update visual sprite position
        if (rocket.updateVisual) {
            rocket.updateVisual(rocket);
        }
    }

    rocket.nextThink = game.time + 0.05;
}

function rocketTouch(rocket, other, game, trace) {
    // Skip if hit owner
    if (other && other === rocket.data.owner) return;

    // Apply direct hit damage to entity (100-120 in original Quake)
    if (other && other.health) {
        game.dealDamage(other, rocket.data.directDamage, rocket.data.owner);
    }

    // Clean up attached light
    if (rocket.data.light && game.effects) {
        game.effects.scene.remove(rocket.data.light);
        rocket.data.light.dispose();
        // Remove from dynamicLights array
        const idx = game.effects.dynamicLights.indexOf(rocket.data.light);
        if (idx !== -1) {
            game.effects.dynamicLights.splice(idx, 1);
        }
    }

    // Clean up visual sprite
    if (game.effects) {
        game.effects.removeProjectileVisual(rocket);
    }

    // Explode with splash damage (excludes direct hit entity)
    explode(rocket, game, other);
}

// Lightning sound timing (original Quake: t_width tracks last sound time)
let lightningLastSoundTime = 0;
let lightningStartSoundPlayed = false;

function fireLightning(player, game) {
    // Original Quake: explode if underwater (waterlevel > 1)
    // T_RadiusDamage(self, self, 35*self.ammo_cells, world)
    // self.ammo_cells = 0
    if (player.waterLevel > 1) {
        const cells = player.ammo.cells + 1;  // +1 because we already consumed 1
        const waterDamage = 35 * cells;

        // Consume ALL remaining cells
        player.ammo.cells = 0;

        // Radius damage to everyone in water (including self)
        const nearby = game.entities.findInRadius(player.position, 256);
        for (const { entity, distanceSq } of nearby) {
            if (!entity.health) continue;

            // Damage falloff based on distance
            const dist = Math.sqrt(distanceSq);
            const dmg = waterDamage * (1 - dist / 256);
            if (dmg > 0) {
                game.dealDamage(entity, dmg, player);
            }
        }

        // Also damage self
        game.dealDamage(player, waterDamage, player);

        // Play explosion effects
        if (game.effects) {
            game.effects.explosion(player.position);
        }
        if (game.audio) {
            game.audio.playLocal('sound/weapons/r_exp3.wav');
        }

        // Switch weapon (out of ammo)
        selectBestWeapon(player);
        return;
    }

    // Play start sound on first fire
    // Original Quake: sound(self, CHAN_AUTO, "weapons/lstart.wav", 1, ATTN_NORM) in W_Attack
    if (!lightningStartSoundPlayed || game.time > player.attackFinished + 0.2) {
        if (game.audio) {
            game.audio.playLocal('sound/weapons/lstart.wav');
        }
        lightningStartSoundPlayed = true;
    }

    // Play lhit sound every 0.6 seconds (original Quake: t_width check)
    // if (self.t_width < time) { sound(...lhit...); self.t_width = time + 0.6; }
    if (game.time > lightningLastSoundTime + 0.6) {
        if (game.audio) {
            game.audio.playLocal('sound/weapons/lhit.wav');
        }
        lightningLastSoundTime = game.time;
    }

    const forward = getForwardVector(player);
    const right = getRightVector(player);

    // Original Quake: org = self.origin + '0 0 16'
    const start = { ...player.position };
    start.z += 16;

    const end = {
        x: start.x + forward.x * 600,
        y: start.y + forward.y * 600,
        z: start.z + forward.z * 600
    };

    const damage = WEAPONS[WEAPON.LIGHTNING].damage;
    const quadMult = (player.items & IT.QUAD) ? 4 : 1;

    // Original Quake: LightningDamage does 3 parallel traces for a "fat" beam
    // This hits targets that are slightly off-center
    // f = perpendicular vector, traces at p1, p1+f, p1-f
    const hitEntities = new Set();  // Track already-hit entities

    // Calculate perpendicular vector (original: f_x = 0 - f_y; f_y = f_x; f_z = 0; f = f*16)
    const perpX = -forward.y;
    const perpY = forward.x;
    const f = {
        x: perpX * 16,
        y: perpY * 16,
        z: 0
    };

    // Trace 1: center
    let beamEnd = end;
    const trace1 = traceHitscan(start, end, player, game);
    if (trace1.hit) {
        beamEnd = trace1.endpos;
        if (trace1.entity && !hitEntities.has(trace1.entity)) {
            hitEntities.add(trace1.entity);
            game.dealDamage(trace1.entity, damage * quadMult, player);
            if (game.effects) {
                game.effects.blood(trace1.endpos);
            }
        }
    }

    // Trace 2: offset +f
    const start2 = { x: start.x + f.x, y: start.y + f.y, z: start.z + f.z };
    const end2 = { x: end.x + f.x, y: end.y + f.y, z: end.z + f.z };
    const trace2 = traceHitscan(start2, end2, player, game);
    if (trace2.hit && trace2.entity && !hitEntities.has(trace2.entity)) {
        hitEntities.add(trace2.entity);
        game.dealDamage(trace2.entity, damage * quadMult, player);
        if (game.effects) {
            game.effects.blood(trace2.endpos);
        }
    }

    // Trace 3: offset -f
    const start3 = { x: start.x - f.x, y: start.y - f.y, z: start.z - f.z };
    const end3 = { x: end.x - f.x, y: end.y - f.y, z: end.z - f.z };
    const trace3 = traceHitscan(start3, end3, player, game);
    if (trace3.hit && trace3.entity && !hitEntities.has(trace3.entity)) {
        hitEntities.add(trace3.entity);
        game.dealDamage(trace3.entity, damage * quadMult, player);
        if (game.effects) {
            game.effects.blood(trace3.endpos);
        }
    }

    // Spawn lightning beam visual (to the closest hit point)
    if (game.effects) {
        game.effects.lightningBeam(start, beamEnd);
    }

    // Wall impact effect if hit world (not entity)
    if (trace1.hit && !trace1.entity) {
        if (game.effects) {
            game.effects.impact(trace1.endpos, trace1.plane?.normal);
        }
    }
}

function explode(projectile, game, directHitEntity = null) {
    // Apply splash damage (excludes entity that took direct hit)
    const center = projectile.position;
    const radius = projectile.data.radius;
    const damage = projectile.data.splashDamage || projectile.data.damage;

    const nearby = game.entities.findInRadius(center, radius);

    for (const { entity, distanceSq } of nearby) {
        if (!entity.health) continue;
        // Skip entity that already took direct hit damage
        if (entity === directHitEntity) continue;

        const dist = Math.sqrt(distanceSq);
        const dmg = damage * (1 - dist / radius);

        if (dmg > 0) {
            game.dealDamage(entity, dmg, projectile.data.owner);
        }
    }

    // Spawn explosion effect
    // game.effects.explosion(center);

    // Spawn explosion effect
    if (game.effects) {
        game.effects.explosion(center);
    }

    // Play explosion sound
    if (game.audio) {
        game.audio.playPositioned('sound/weapons/r_exp3.wav', center);
    }

    game.entities.remove(projectile);
    game.physics.removeEntity(projectile);
}

function applyDamage(trace, damage, attacker, game) {
    const hitPoint = trace.endpos;

    // Hit world - spawn impact particles
    if (game.effects) {
        game.effects.impact(hitPoint, trace.plane?.normal);
    }
}

// Check for entity hits along a line (for hitscan weapons)
function traceHitscan(start, end, attacker, game) {
    // First check for entity collisions
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const dir = { x: dx / length, y: dy / length, z: dz / length };

    let closestHit = null;
    let closestDist = length;

    // Check all entities with health
    for (const monster of game.entities.monsters) {
        if (!monster.active || monster.health <= 0) continue;
        if (monster === attacker) continue;

        // Simple ray-box intersection
        const hull = monster.hull || { mins: { x: -16, y: -16, z: -24 }, maxs: { x: 16, y: 16, z: 40 } };
        const mins = {
            x: monster.position.x + hull.mins.x,
            y: monster.position.y + hull.mins.y,
            z: monster.position.z + hull.mins.z
        };
        const maxs = {
            x: monster.position.x + hull.maxs.x,
            y: monster.position.y + hull.maxs.y,
            z: monster.position.z + hull.maxs.z
        };

        const hit = rayBoxIntersect(start, dir, mins, maxs, closestDist);
        if (hit !== null && hit < closestDist) {
            closestDist = hit;
            closestHit = monster;
        }
    }

    // Check world collision
    const worldTrace = game.physics.traceLine(start, end);

    if (closestHit && closestDist < worldTrace.fraction * length) {
        // Hit entity
        return {
            hit: true,
            entity: closestHit,
            fraction: closestDist / length,
            endpos: {
                x: start.x + dir.x * closestDist,
                y: start.y + dir.y * closestDist,
                z: start.z + dir.z * closestDist
            }
        };
    }

    // Hit world or nothing
    return {
        hit: worldTrace.fraction < 1.0,
        entity: null,
        fraction: worldTrace.fraction,
        endpos: worldTrace.endpos,
        plane: worldTrace.plane
    };
}

function rayBoxIntersect(origin, dir, mins, maxs, maxDist) {
    let tmin = 0;
    let tmax = maxDist;

    for (let i = 0; i < 3; i++) {
        const axis = ['x', 'y', 'z'][i];
        const invD = 1.0 / dir[axis];
        let t0 = (mins[axis] - origin[axis]) * invD;
        let t1 = (maxs[axis] - origin[axis]) * invD;

        if (invD < 0) {
            [t0, t1] = [t1, t0];
        }

        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);

        if (tmax < tmin) {
            return null;
        }
    }

    return tmin;
}

function getForwardVector(player) {
    const yaw = player.angles.yaw * Math.PI / 180;
    const pitch = player.angles.pitch * Math.PI / 180;

    return {
        x: Math.cos(yaw) * Math.cos(pitch),
        y: Math.sin(yaw) * Math.cos(pitch),
        z: -Math.sin(pitch)
    };
}

function getRightVector(player) {
    const yaw = player.angles.yaw * Math.PI / 180;

    return {
        x: Math.sin(yaw),
        y: -Math.cos(yaw),
        z: 0
    };
}

function selectBestWeapon(player) {
    // Try weapons in order of preference
    const preference = [
        WEAPON.LIGHTNING,
        WEAPON.SUPER_NAILGUN,
        WEAPON.SUPER_SHOTGUN,
        WEAPON.NAILGUN,
        WEAPON.SHOTGUN,
        WEAPON.AXE
    ];

    for (const weaponNum of preference) {
        const weapon = WEAPONS[weaponNum];
        const flag = getWeaponFlag(weaponNum);

        if (!(player.weapons & flag)) continue;

        if (!weapon.ammoType || player.ammo[weapon.ammoType] >= weapon.ammoUse) {
            player.currentWeapon = weaponNum;
            return;
        }
    }
}

function getWeaponFlag(weaponNum) {
    const flags = {
        [WEAPON.AXE]: IT.AXE,
        [WEAPON.SHOTGUN]: IT.SHOTGUN,
        [WEAPON.SUPER_SHOTGUN]: IT.SUPER_SHOTGUN,
        [WEAPON.NAILGUN]: IT.NAILGUN,
        [WEAPON.SUPER_NAILGUN]: IT.SUPER_NAILGUN,
        [WEAPON.GRENADE_LAUNCHER]: IT.GRENADE_LAUNCHER,
        [WEAPON.ROCKET_LAUNCHER]: IT.ROCKET_LAUNCHER,
        [WEAPON.LIGHTNING]: IT.LIGHTNING
    };
    return flags[weaponNum] || 0;
}
