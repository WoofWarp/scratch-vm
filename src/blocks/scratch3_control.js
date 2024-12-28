const Cast = require('../util/cast');

class Scratch3ControlBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        /**
         * The "counter" block value. For compatibility with 2.0.
         * @type {number}
         */
        this._counter = 0; // used by compiler

        this.runtime.on('RUNTIME_DISPOSED', this.clearCounter.bind(this));
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            control_repeat: this.repeat,
            control_repeat_until: this.repeatUntil,
            control_while: this.repeatWhile,
            control_for_each: this.forEach,
            control_forever: this.forever,
            control_wait: this.wait,
            control_wait_until: this.waitUntil,
            control_if: this.if,
            control_if_else: this.ifElse,
            control_stop: this.stop,
            control_create_clone_of: this.createClone,
            control_delete_this_clone: this.deleteClone,
            control_get_counter: this.getCounter,
            control_incr_counter: this.incrCounter,
            control_clear_counter: this.clearCounter,
            control_all_at_once: this.allAtOnce
        };
    }

    getHats () {
        return {
            control_start_as_clone: {
                restartExistingThreads: false
            }
        };
    }

    *repeat (args, util) {
        const times = Math.round(Cast.toNumber(yield* args.TIMES()));
        for (let i = times; i--;) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            yield util.yield();
        }
        // // Initialize loop
        // if (typeof util.stackFrame.loopCounter === 'undefined') {
        //     util.stackFrame.loopCounter = times;
        // }
        // // Only execute once per frame.
        // // When the branch finishes, `repeat` will be executed again and
        // // the second branch will be taken, yielding for the rest of the frame.
        // // Decrease counter
        // util.stackFrame.loopCounter--;
        // // If we still have some left, start the branch.
        // if (util.stackFrame.loopCounter >= 0) {
        //     util.startBranch(1, true);
        // }
    }

    *repeatUntil (args, util) {
        while (!args.CONDITION || !(yield* args.CONDITION())) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            yield util.yield();
        }
        // const condition = Cast.toBoolean(args.CONDITION);
        // // If the condition is false (repeat UNTIL), start the branch.
        // if (!condition) {
        //     util.startBranch(1, true);
        // }
    }

    *repeatWhile (args, util) {
        while (args.CONDITION && (yield* args.CONDITION())) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            yield util.yield();
        }
    }

    *forEach (args, util) {
        const variable = util.target.lookupOrCreateVariable(
            args.VARIABLE.id, args.VARIABLE.name);
        
        for (let i = 1; i <= Number(args.VALUE); i++) {
            variable.value = i;
            if (args.SUBSTACK) yield* args.SUBSTACK();
            yield util.yield();
        }
        // if (typeof util.stackFrame.index === 'undefined') {
        //     util.stackFrame.index = 0;
        // }

        // if (util.stackFrame.index < Number(args.VALUE)) {
        //     util.stackFrame.index++;
        //     variable.value = util.stackFrame.index;
        //     util.startBranch(1, true);
        // }
    }

    *waitUntil (args, util) {
        while (!Cast.toBoolean(yield* args.CONDITION())) {
            yield util.yield();
        }
    }

    *forever (args, util) {
        for (;;) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            yield util.yield();
        }
    }

    *wait (args, util) {
        const duration = Math.max(0, 1000 * Cast.toNumber(yield* args.DURATION()));
        const timer = util.startTimer(duration);
        this.runtime.requestRedraw();
        yield util.yield();
        while (timer.timeElapsed() < duration) {
            yield util.yield();
        }
    }

    *if (args, util) {
        if (args.CONDITION && Cast.toBoolean(yield* args.CONDITION())) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            else yield util.yield();
        }
    }

    *ifElse (args, util) {
        if (args.CONDITION && Cast.toBoolean(yield* args.CONDITION())) {
            if (args.SUBSTACK) yield* args.SUBSTACK();
            else yield util.yield();
        } else if (args.SUBSTACK2) yield* args.SUBSTACK2();
        else yield util.yield();
    }

    *stop (args, util) {
        const option = args.STOP_OPTION.value;
        if (option === 'all') {
            util.stopAll();
        } else if (option === 'other scripts in sprite' ||
            option === 'other scripts in stage') {
            util.stopOtherTargetThreads();
        } else if (option === 'this script') {
            yield* util.stopThisScript();
        }
    }

    *createClone (args, util) {
        const target = util.target;
        this._createClone(Cast.toString(yield* args.CLONE_OPTION()), target);
    }
    _createClone (cloneOption, target) { // used by compiler
        // Set clone target
        let cloneTarget;
        if (cloneOption === '_myself_') {
            cloneTarget = target;
        } else {
            cloneTarget = this.runtime.getSpriteTargetByName(cloneOption);
        }

        // If clone target is not found, return
        if (!cloneTarget) return;

        // Create clone
        const newClone = cloneTarget.makeClone();
        if (newClone) {
            this.runtime.addTarget(newClone);

            // Place behind the original target.
            newClone.goBehindOther(cloneTarget);
        }
    }

    deleteClone (args, util) {
        const target = util.target;
        if (target.isOriginal) return;
        this.runtime.disposeTarget(target);
        this.runtime.stopForTarget(target);
    }

    getCounter () {
        return this._counter;
    }

    clearCounter () {
        this._counter = 0;
    }

    incrCounter () {
        this._counter++;
    }

    *allAtOnce (args) {
        // Since the "all at once" block is implemented for compatiblity with
        // Scratch 2.0 projects, it behaves the same way it did in 2.0, which
        // is to simply run the contained script (like "if 1 = 1").
        // (In early versions of Scratch 2.0, it would work the same way as
        // "run without screen refresh" custom blocks do now, but this was
        // removed before the release of 2.0.)
        yield* args.SUBSTACK();
    }
}

module.exports = Scratch3ControlBlocks;
