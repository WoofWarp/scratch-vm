const Cast = require('../util/cast');
const MathUtil = require('../util/math-util');

class Scratch3MotionBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            motion_movesteps: this.moveSteps,
            motion_gotoxy: this.goToXY,
            motion_goto: this.goTo,
            motion_turnright: this.turnRight,
            motion_turnleft: this.turnLeft,
            motion_pointindirection: this.pointInDirection,
            motion_pointtowards: this.pointTowards,
            motion_glidesecstoxy: this.glide,
            motion_glideto: this.glideTo,
            motion_ifonedgebounce: this.ifOnEdgeBounce,
            motion_setrotationstyle: this.setRotationStyle,
            motion_changexby: this.changeX,
            motion_setx: this.setX,
            motion_changeyby: this.changeY,
            motion_sety: this.setY,
            motion_xposition: this.getX,
            motion_yposition: this.getY,
            motion_direction: this.getDirection,
            // Legacy no-op blocks:
            motion_scroll_right: () => {},
            motion_scroll_up: () => {},
            motion_align_scene: () => {},
            motion_xscroll: () => {},
            motion_yscroll: () => {}
        };
    }

    getMonitored () {
        return {
            motion_xposition: {
                isSpriteSpecific: true,
                getId: targetId => `${targetId}_xposition`
            },
            motion_yposition: {
                isSpriteSpecific: true,
                getId: targetId => `${targetId}_yposition`
            },
            motion_direction: {
                isSpriteSpecific: true,
                getId: targetId => `${targetId}_direction`
            }
        };
    }

    *moveSteps (args, util) {
        const target = util.target;
        const steps = Cast.toNumber(yield* args.STEPS());
        this._moveSteps(steps, target);
    }
    _moveSteps (steps, target) { // used by compiler
        const radians = MathUtil.degToRad(90 - target.direction);
        const dx = steps * Math.cos(radians);
        const dy = steps * Math.sin(radians);
        target.setXY(target.x + dx, target.y + dy);
    }

    *goToXY (args, util) {
        const target = util.target;
        const x = Cast.toNumber(yield* args.X());
        const y = Cast.toNumber(yield* args.Y());
        target.setXY(x, y);
    }

    getTargetXY (targetName, util) {
        let targetX = 0;
        let targetY = 0;
        if (targetName === '_mouse_') {
            targetX = util.ioQuery('mouse', 'getScratchX');
            targetY = util.ioQuery('mouse', 'getScratchY');
        } else if (targetName === '_random_') {
            const stageWidth = this.runtime.stageWidth;
            const stageHeight = this.runtime.stageHeight;
            targetX = Math.round(stageWidth * (Math.random() - 0.5));
            targetY = Math.round(stageHeight * (Math.random() - 0.5));
        } else {
            targetName = Cast.toString(targetName);
            const goToTarget = this.runtime.getSpriteTargetByName(targetName);
            if (!goToTarget) return;
            targetX = goToTarget.x;
            targetY = goToTarget.y;
        }
        return [targetX, targetY];
    }

    *goTo (args, util) {
        const target = util.target;
        const targetXY = this.getTargetXY(yield* args.TO(), util);
        if (targetXY) {
            target.setXY(targetXY[0], targetXY[1]);
        }
    }

    *turnRight (args, util) {
        const target = util.target;
        const degrees = Cast.toNumber(yield* args.DEGREES());
        target.setDirection(target.direction + degrees);
    }

    *turnLeft (args, util) {
        const target = util.target;
        const degrees = Cast.toNumber(yield* args.DEGREES());
        target.setDirection(target.direction - degrees);
    }

    *pointInDirection (args, util) {
        const target = util.target;
        const direction = Cast.toNumber(yield* args.DIRECTION());
        target.setDirection(direction);
    }

    *pointTowards (args, util) {
        const target = util.target;
        let targetX = 0;
        let targetY = 0;
        let towards = yield* args.TOWARDS();
        if (towards === '_mouse_') {
            targetX = util.ioQuery('mouse', 'getScratchX');
            targetY = util.ioQuery('mouse', 'getScratchY');
        } else if (towards === '_random_') {
            target.setDirection(Math.round(Math.random() * 360) - 180);
            return;
        } else {
            towards = Cast.toString(towards);
            const pointTarget = this.runtime.getSpriteTargetByName(towards);
            if (!pointTarget) return;
            targetX = pointTarget.x;
            targetY = pointTarget.y;
        }

        const dx = targetX - target.x;
        const dy = targetY - target.y;
        const direction = 90 - MathUtil.radToDeg(Math.atan2(dy, dx));
        target.setDirection(direction);
    }

    *glide (args, util) {
        // First time: save data for future use.
        const target = util.target;
        const timer = util.startTimer();
        const duration = Cast.toNumber(yield* args.SECS());
        const startX = target.x; const startY = target.y;
        const endX = Cast.toNumber(yield* args.X()); const endY = Cast.toNumber(yield* args.Y());
        if (duration <= 0) {
            // Duration too short to glide.
            target.setXY(endX, endY);
            return;
        }
        yield util.yield();
        while (1) {
            const timeElapsed = timer.timeElapsed();
            if (timeElapsed >= duration * 1000) {
                // Finished: move to final position.
                target.setXY(endX, endY);
                break;
            }
            // In progress: move to intermediate position.
            const frac = timeElapsed / (duration * 1000);
            const dx = frac * (endX - startX);
            const dy = frac * (endY - startY);
            target.setXY(startX + dx, startY + dy);
            yield util.yield();
        }
    }

    *glideTo (args, util) {
        const target = util.target;
        const targetXY = this.getTargetXY(yield* args.TO(), util);
        if (targetXY) {
            const fakeUtil = {target, yield: util.yield, startTimer: util.startTimer};
            this.glide({SECS: args.SECS, X: targetXY[0], Y: targetXY[1]}, fakeUtil);
        }
    }

    ifOnEdgeBounce (args, util) {
        this._ifOnEdgeBounce(util.target);
    }
    _ifOnEdgeBounce (target) { // used by compiler
        const bounds = target.getBounds();
        if (!bounds) {
            return;
        }
        // Measure distance to edges.
        // Values are positive when the sprite is far away,
        // and clamped to zero when the sprite is beyond.
        const stageWidth = this.runtime.stageWidth;
        const stageHeight = this.runtime.stageHeight;
        const distLeft = Math.max(0, (stageWidth / 2) + bounds.left);
        const distTop = Math.max(0, (stageHeight / 2) - bounds.top);
        const distRight = Math.max(0, (stageWidth / 2) - bounds.right);
        const distBottom = Math.max(0, (stageHeight / 2) + bounds.bottom);
        // Find the nearest edge.
        let nearestEdge = '';
        let minDist = Infinity;
        if (distLeft < minDist) {
            minDist = distLeft;
            nearestEdge = 'left';
        }
        if (distTop < minDist) {
            minDist = distTop;
            nearestEdge = 'top';
        }
        if (distRight < minDist) {
            minDist = distRight;
            nearestEdge = 'right';
        }
        if (distBottom < minDist) {
            minDist = distBottom;
            nearestEdge = 'bottom';
        }
        if (minDist > 0) {
            return; // Not touching any edge.
        }
        // Point away from the nearest edge.
        const radians = MathUtil.degToRad(90 - target.direction);
        let dx = Math.cos(radians);
        let dy = -Math.sin(radians);
        if (nearestEdge === 'left') {
            dx = Math.max(0.2, Math.abs(dx));
        } else if (nearestEdge === 'top') {
            dy = Math.max(0.2, Math.abs(dy));
        } else if (nearestEdge === 'right') {
            dx = 0 - Math.max(0.2, Math.abs(dx));
        } else if (nearestEdge === 'bottom') {
            dy = 0 - Math.max(0.2, Math.abs(dy));
        }
        const newDirection = MathUtil.radToDeg(Math.atan2(dy, dx)) + 90;
        target.setDirection(newDirection);
        // Keep within the stage.
        const fencedPosition = target.keepInFence(target.x, target.y);
        target.setXY(fencedPosition[0], fencedPosition[1]);
    }

    setRotationStyle (args, util) {
        util.target.setRotationStyle(args.STYLE.value);
    }

    *changeX (args, util) {
        const target = util.target;
        const dx = Cast.toNumber(yield* args.DX());
        target.setXY(util.target.x + dx, util.target.y);
    }

    *setX (args, util) {
        const target = util.target;
        const x = Cast.toNumber(yield* args.X());
        target.setXY(x, target.y);
    }

    *changeY (args, util) {
        const target = util.target;
        const dy = Cast.toNumber(yield* args.DY());
        target.setXY(target.x, target.y + dy);
    }

    *setY (args, util) {
        const target = util.target;
        const y = Cast.toNumber(yield* args.Y());
        target.setXY(target.x, y);
    }

    getX (args, util) {
        return this.limitPrecision(util.target.x);
    }

    getY (args, util) {
        return this.limitPrecision(util.target.y);
    }

    getDirection (args, util) {
        return util.target.direction;
    }

    // This corresponds to snapToInteger in Scratch 2
    limitPrecision (coordinate) {
        const rounded = Math.round(coordinate);
        const delta = coordinate - rounded;
        const limitedCoord = (Math.abs(delta) < 1e-9) ? rounded : coordinate;

        return limitedCoord;
    }
}

module.exports = Scratch3MotionBlocks;
