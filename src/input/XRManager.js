import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

/**
 * XRManager - Handles WebXR session and controller input for VR mode
 *
 * Uses Three.js built-in WebXR support:
 * - Left thumbstick: Movement (forward/back, strafe left/right)
 * - Right thumbstick: Snap turn (rotation)
 * - Either trigger: Fire weapon
 */
export class XRManager {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this.isPresenting = false;

        // Controller references
        this.controller0 = null;
        this.controller1 = null;
        this.controllerGrip0 = null;
        this.controllerGrip1 = null;
        this.controllerModelFactory = new XRControllerModelFactory();

        // Input state (updated each frame from controller input)
        this.inputState = {
            moveForward: 0,
            moveRight: 0,
            turn: 0,
            fire: false,
            firePressed: false,
            jump: false
        };

        // Previous trigger states for edge detection
        this.prevTriggerStates = [false, false];

        // Snap turn settings
        this.snapTurnAngle = 45; // degrees
        this.snapTurnCooldown = 0;
        this.snapTurnDelay = 0.3; // seconds between snap turns
        this.pendingSnapTurn = 0;

        // Deadzone for joystick input
        this.deadzone = 0.15;

        // VR camera rig (parent for camera in VR mode)
        // This group will be moved to position the player in the world
        this.cameraRig = new THREE.Group();
        this.cameraRig.name = 'xrCameraRig';

        // Note: Quake uses Z-up, WebXR uses Y-up
        // We'll handle the coordinate system difference in position/rotation methods
        // rather than rotating the rig itself, which causes issues

        // Callbacks
        this.onSessionStart = null;
        this.onSessionEnd = null;
        this.onFire = null;
    }

    /**
     * Check if WebXR is supported
     */
    static async isSupported() {
        if (!navigator.xr) {
            return false;
        }
        try {
            return await navigator.xr.isSessionSupported('immersive-vr');
        } catch (e) {
            console.warn('WebXR support check failed:', e);
            return false;
        }
    }

    /**
     * Initialize WebXR on the renderer
     */
    init() {
        // Enable XR on the renderer
        this.renderer.xr.enabled = true;

        // Set the reference space type - 'local-floor' gives us floor-level tracking
        this.renderer.xr.setReferenceSpaceType('local-floor');

        // Set up controllers
        this.setupControllers();

        // Listen for session start/end
        this.renderer.xr.addEventListener('sessionstart', () => {
            console.log('=== WebXR session started ===');
            this.isPresenting = true;

            // Don't rotate the rig here - we rotate the world container instead
            // This is handled in Renderer.js initXR callback

            // Listen for input sources to be added (controllers may connect after session starts)
            const session = this.renderer.xr.getSession();
            if (session) {
                session.addEventListener('inputsourceschange', (event) => {
                    console.log('Input sources changed:', event.added?.length, 'added,', event.removed?.length, 'removed');
                    console.log('Total input sources:', session.inputSources?.length);
                });
            }

            if (this.onSessionStart) {
                this.onSessionStart();
            }
        });

        this.renderer.xr.addEventListener('sessionend', () => {
            console.log('WebXR session ended');
            this.isPresenting = false;
            this.resetInputState();
            if (this.onSessionEnd) {
                this.onSessionEnd();
            }
        });
    }

    /**
     * Set up VR controllers with models
     */
    setupControllers() {
        // Controller 0 (typically left)
        this.controller0 = this.renderer.xr.getController(0);
        this.controller0.name = 'controller0';
        this.cameraRig.add(this.controller0);

        // Controller 1 (typically right)
        this.controller1 = this.renderer.xr.getController(1);
        this.controller1.name = 'controller1';
        this.cameraRig.add(this.controller1);

        // Controller grips with models
        this.controllerGrip0 = this.renderer.xr.getControllerGrip(0);
        this.controllerGrip0.add(this.controllerModelFactory.createControllerModel(this.controllerGrip0));
        this.cameraRig.add(this.controllerGrip0);

        this.controllerGrip1 = this.renderer.xr.getControllerGrip(1);
        this.controllerGrip1.add(this.controllerModelFactory.createControllerModel(this.controllerGrip1));
        this.cameraRig.add(this.controllerGrip1);

        // Add visual ray for aiming (simple line)
        const rayGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, 0, -5)
        ]);
        const rayMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });

        const ray0 = new THREE.Line(rayGeometry.clone(), rayMaterial.clone());
        this.controller0.add(ray0);

        const ray1 = new THREE.Line(rayGeometry.clone(), rayMaterial.clone());
        this.controller1.add(ray1);

        // Event listeners for select (trigger)
        this.controller0.addEventListener('selectstart', () => this.onSelectStart(0));
        this.controller0.addEventListener('selectend', () => this.onSelectEnd(0));
        this.controller1.addEventListener('selectstart', () => this.onSelectStart(1));
        this.controller1.addEventListener('selectend', () => this.onSelectEnd(1));

        console.log('XR controllers initialized');
    }

    /**
     * Handle trigger press
     */
    onSelectStart(_controllerIndex) {
        this.inputState.firePressed = true;
        this.inputState.fire = true;
        if (this.onFire) {
            this.onFire();
        }
    }

    /**
     * Handle trigger release
     */
    onSelectEnd(_controllerIndex) {
        this.inputState.firePressed = false;
    }

    /**
     * Get the camera rig for adding to scene
     */
    getCameraRig() {
        return this.cameraRig;
    }

    /**
     * Set camera rig position (for player movement)
     * Position comes in Quake coordinates (X, Y, Z where Z is up)
     * Since the world container is rotated -90° around X to convert to Y-up,
     * we need to transform the rig position to match:
     * - Rotation -90° around X transforms (x, y, z) -> (x, z, -y)
     * - So to place the rig at the correct location in the rotated world,
     *   we apply the same transform to the rig position
     */
    setPosition(x, y, z) {
        // Transform from Quake (X, Y, Z where Z=up) to rotated world (X, Z, -Y where Y=up)
        this.cameraRig.position.set(x, z, -y);
    }

    /**
     * Set camera rig Y rotation (for snap turning)
     * In the rotated coordinate system, turning left/right is around the Y axis
     */
    setRotationY(angle) {
        this.cameraRig.rotation.y = angle;
    }

    /**
     * Get camera rig Y rotation
     */
    getRotationY() {
        return this.cameraRig.rotation.y;
    }

    /**
     * Apply deadzone to axis value
     */
    applyDeadzone(value) {
        if (Math.abs(value) < this.deadzone) {
            return 0;
        }
        // Rescale so movement starts at 0 after deadzone
        const sign = Math.sign(value);
        return sign * (Math.abs(value) - this.deadzone) / (1 - this.deadzone);
    }

    /**
     * Update input state from controllers (call each frame)
     */
    update(deltaTime) {
        // Use Three.js's isPresenting check directly - more reliable than our flag
        const isPresenting = this.renderer.xr.isPresenting;

        if (!isPresenting) {
            return;
        }

        // Update our flag to match (for other code that checks it)
        this.isPresenting = true;

        const session = this.renderer.xr.getSession();
        if (!session) {
            return;
        }

        // Get input sources (gamepads) - check early if they exist
        const inputSources = session.inputSources;

        // If no input sources yet, the controllers haven't connected - skip this frame
        if (!inputSources || inputSources.length === 0) {
            return;
        }

        // Reset movement input (will be set from gamepad)
        this.inputState.moveForward = 0;
        this.inputState.moveRight = 0;
        this.inputState.turn = 0;
        this.inputState.fire = false; // Reset fire, only set on edge

        // Update snap turn cooldown
        if (this.snapTurnCooldown > 0) {
            this.snapTurnCooldown -= deltaTime;
        }

        for (const source of inputSources) {
            const handedness = source.handedness; // 'left', 'right', or 'none'
            const gamepad = source.gamepad;

            if (!gamepad) continue;

            // Debug: log gamepad info on first detection
            if (gamepad.axes.length > 0) {
                // Standard XR gamepad layout:
                // axes[0], axes[1] = touchpad (if present)
                // axes[2], axes[3] = thumbstick
                // We try thumbstick first (indices 2,3), fallback to 0,1
                const thumbstickX = gamepad.axes.length > 2 ? gamepad.axes[2] : gamepad.axes[0];
                const thumbstickY = gamepad.axes.length > 3 ? gamepad.axes[3] : gamepad.axes[1];

                const axisX = this.applyDeadzone(thumbstickX);
                const axisY = this.applyDeadzone(thumbstickY);

                if (handedness === 'left') {
                    // Left stick: movement
                    // Standard mapping: Y axis = forward/back, X axis = strafe
                    // Movement direction is now handled by updating player yaw from VR camera
                    this.inputState.moveForward = -axisY; // Forward is negative Y on thumbstick
                    this.inputState.moveRight = axisX;    // Right is positive X
                } else if (handedness === 'right') {
                    // Right stick: snap turning
                    if (Math.abs(axisX) > 0.5 && this.snapTurnCooldown <= 0) {
                        this.pendingSnapTurn = Math.sign(axisX) * this.snapTurnAngle;
                        this.snapTurnCooldown = this.snapTurnDelay;
                    }
                } else {
                    // Handedness is 'none' - try to use for movement anyway
                    this.inputState.moveForward = -axisY;
                    this.inputState.moveRight = axisX;
                }
            }

            // Check trigger for continuous fire detection
            if (gamepad.buttons.length > 0) {
                const trigger = gamepad.buttons[0];
                if (trigger && trigger.pressed) {
                    // For continuous weapons, you might want to track this
                    this.inputState.firePressed = true;
                }
            }

            // Check A/X button for jump (usually button index 4 or 5)
            if (gamepad.buttons.length > 4) {
                const jumpButton = gamepad.buttons[4];
                if (jumpButton && jumpButton.pressed) {
                    this.inputState.jump = true;
                } else {
                    this.inputState.jump = false;
                }
            }
        }

        // Apply pending snap turn
        if (this.pendingSnapTurn !== 0) {
            this.inputState.turn = this.pendingSnapTurn;
            this.pendingSnapTurn = 0;
        }
    }

    /**
     * Get current input state
     */
    getInputState() {
        return this.inputState;
    }

    /**
     * Reset input state
     */
    resetInputState() {
        this.inputState.moveForward = 0;
        this.inputState.moveRight = 0;
        this.inputState.turn = 0;
        this.inputState.fire = false;
        this.inputState.firePressed = false;
        this.inputState.jump = false;
        this.pendingSnapTurn = 0;
    }

    /**
     * Get the XR camera (for positioning player)
     */
    getXRCamera() {
        return this.renderer.xr.getCamera();
    }

    /**
     * Dispose of XR resources
     */
    dispose() {
        if (this.controller0) {
            this.cameraRig.remove(this.controller0);
        }
        if (this.controller1) {
            this.cameraRig.remove(this.controller1);
        }
        if (this.controllerGrip0) {
            this.cameraRig.remove(this.controllerGrip0);
        }
        if (this.controllerGrip1) {
            this.cameraRig.remove(this.controllerGrip1);
        }
    }
}
