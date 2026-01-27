/**
 * InputManager - Handles keyboard and mouse input with Pointer Lock
 */
export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;

        // Key states
        this.keys = new Map();
        this.keysPressed = new Map();  // Just pressed this frame
        this.keysReleased = new Map(); // Just released this frame

        // Mouse state
        this.mouseDelta = { x: 0, y: 0 };
        this.mouseButtons = new Map();
        this.sensitivity = 0.15;
        this.invertMouse = false;
        this.alwaysRun = false;

        // Movement input (normalized)
        this.moveInput = { forward: 0, right: 0, up: 0 };

        // Pointer lock state
        this.pointerLocked = false;

        // Bind handlers
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onPointerLockChange = this.onPointerLockChange.bind(this);
        this.onPointerLockError = this.onPointerLockError.bind(this);

        // Add event listeners
        document.addEventListener('keydown', this.onKeyDown);
        document.addEventListener('keyup', this.onKeyUp);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mouseup', this.onMouseUp);
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
        document.addEventListener('pointerlockerror', this.onPointerLockError);

        // Key bindings (Quake-style)
        this.bindings = {
            forward: ['KeyW', 'ArrowUp'],
            back: ['KeyS', 'ArrowDown'],
            left: ['KeyA', 'ArrowLeft'],
            right: ['KeyD', 'ArrowRight'],
            jump: ['Space'],
            crouch: ['KeyC', 'ControlLeft', 'ControlRight'], // Swim down in water
            attack: ['Mouse0'],
            use: ['KeyE'],
            weapon1: ['Digit1'],
            weapon2: ['Digit2'],
            weapon3: ['Digit3'],
            weapon4: ['Digit4'],
            weapon5: ['Digit5'],
            weapon6: ['Digit6'],
            weapon7: ['Digit7'],
            weapon8: ['Digit8']
        };
    }

    requestPointerLock() {
        this.canvas.requestPointerLock();
    }

    exitPointerLock() {
        document.exitPointerLock();
    }

    onPointerLockChange() {
        this.pointerLocked = document.pointerLockElement === this.canvas;
        console.log('Pointer lock:', this.pointerLocked);
    }

    onPointerLockError() {
        console.error('Pointer lock failed');
    }

    onKeyDown(event) {
        if (event.repeat) return;

        const code = event.code;
        if (!this.keys.get(code)) {
            this.keysPressed.set(code, true);
        }
        this.keys.set(code, true);

        // Prevent default for game keys
        if (this.isGameKey(code)) {
            event.preventDefault();
        }
    }

    onKeyUp(event) {
        const code = event.code;
        this.keys.set(code, false);
        this.keysReleased.set(code, true);
    }

    onMouseMove(event) {
        if (!this.pointerLocked) return;

        this.mouseDelta.x += event.movementX;
        this.mouseDelta.y += event.movementY;
    }

    onMouseDown(event) {
        const button = `Mouse${event.button}`;
        this.mouseButtons.set(button, true);
        this.keysPressed.set(button, true);
    }

    onMouseUp(event) {
        const button = `Mouse${event.button}`;
        this.mouseButtons.set(button, false);
        this.keysReleased.set(button, true);
    }

    isGameKey(code) {
        for (const keys of Object.values(this.bindings)) {
            if (keys.includes(code)) {
                return true;
            }
        }
        return false;
    }

    isDown(action) {
        const keys = this.bindings[action];
        if (!keys) return false;

        for (const key of keys) {
            if (this.keys.get(key) || this.mouseButtons.get(key)) {
                return true;
            }
        }
        return false;
    }

    isPressed(action) {
        const keys = this.bindings[action];
        if (!keys) return false;

        for (const key of keys) {
            if (this.keysPressed.get(key)) {
                return true;
            }
        }
        return false;
    }

    isReleased(action) {
        const keys = this.bindings[action];
        if (!keys) return false;

        for (const key of keys) {
            if (this.keysReleased.get(key)) {
                return true;
            }
        }
        return false;
    }

    update() {
        // Calculate movement input
        this.moveInput.forward = 0;
        this.moveInput.right = 0;
        this.moveInput.up = 0;

        if (this.isDown('forward')) this.moveInput.forward += 1;
        if (this.isDown('back')) this.moveInput.forward -= 1;
        if (this.isDown('right')) this.moveInput.right += 1;
        if (this.isDown('left')) this.moveInput.right -= 1;
        if (this.isDown('jump')) this.moveInput.up += 1;
        if (this.isDown('crouch')) this.moveInput.up -= 1; // Swim down in water

        // Normalize diagonal movement
        const mag = Math.sqrt(
            this.moveInput.forward * this.moveInput.forward +
            this.moveInput.right * this.moveInput.right
        );

        if (mag > 1) {
            this.moveInput.forward /= mag;
            this.moveInput.right /= mag;
        }
    }

    getMouseDelta() {
        const yMultiplier = this.invertMouse ? -1 : 1;
        const delta = {
            x: this.mouseDelta.x * this.sensitivity,
            y: this.mouseDelta.y * this.sensitivity * yMultiplier
        };
        return delta;
    }

    clearFrame() {
        // Clear per-frame states
        this.keysPressed.clear();
        this.keysReleased.clear();
        this.mouseDelta.x = 0;
        this.mouseDelta.y = 0;
    }

    getMoveInput() {
        return {
            forward: this.moveInput.forward,
            right: this.moveInput.right,
            up: this.moveInput.up,
            jump: this.isDown('jump'),
            attack: this.isDown('attack'),
            use: this.isPressed('use'),
            alwaysRun: this.alwaysRun
        };
    }

    getWeaponSelect() {
        for (let i = 1; i <= 8; i++) {
            if (this.isPressed(`weapon${i}`)) {
                return i;
            }
        }
        return 0;
    }

    destroy() {
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('keyup', this.onKeyUp);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mouseup', this.onMouseUp);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
        document.removeEventListener('pointerlockerror', this.onPointerLockError);
    }
}
