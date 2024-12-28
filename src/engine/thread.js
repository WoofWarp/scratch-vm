const log = require("../util/log");
const execute = require("../compiler/jsexecute");
const generate = require("./generate");
const {
    StopThisScript,
    Yield,
    YieldTick,
    KillThread,
} = require("./thread-status");
const blockUtility = require("./block-utility-instance");

/**
 * Utility function to determine if a value is a Promise.
 * @param {*} value Value to check for a Promise.
 * @return {boolean} True if the value appears to be a Promise.
 */
const isPromise = function (value) {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.then === "function"
    );
};

/**
 * A thread is a running stack context and all the metadata needed.
 * @param {?string} firstBlock First block to execute in the thread.
 * @constructor
 */
class Thread {
    constructor(firstBlock) {
        /**
         * ID of top block of the thread
         * @type {!string}
         */
        this.topBlock = firstBlock;

        /**
         * Status of the thread, one of three states (below)
         * @type {number}
         */
        this._status = Thread.STATUS_RUNNING; /* Thread.STATUS_RUNNING */

        /**
         * Whether the thread is killed in the middle of execution.
         * @type {boolean}
         */
        this.isKilled = false;

        /**
         * Target of this thread.
         * @type {?import('./target')}
         */
        this.target = null;

        /**
         * The Blocks this thread will execute.
         * @type {import('./blocks')}
         */
        this.blockContainer = null;

        /**
         * Whether the thread requests its script to glow during this frame.
         * @type {boolean}
         */
        this.requestScriptGlowInFrame = false;

        /**
         * Which block ID should glow during this frame, if any.
         * @type {?string}
         */
        this.blockGlowInFrame = null;

        /**
         * A timer for when the thread enters warp mode.
         * Substitutes the sequencer's count toward WORK_TIME on a per-thread basis.
         * @type {?import('../util/timer')}
         */
        this.warpTimer = null;

        this.promiseResult = [0, null];

        this.justReported = null;

        this.triedToCompile = false;

        this.isCompiled = false;

        // compiler data
        // these values only make sense if isCompiled == true
        this.timer = null;
        /**
         * The thread's generator.
         * @type {Generator}
         */
        this.generator = null;
        /**
         * @type {Object.<string, import('../compiler/compile').CompiledScript>}
         */
        this.procedures = null;
        this.executableHat = false;

        this.context = {};
    }

    /**
     * Thread status for initialized or running thread.
     * This is the default state for a thread - execution should run normally,
     * stepping from block to block.
     * @const
     */
    static get STATUS_RUNNING() {
        return 0; // used by compiler
    }

    /**
     * Threads are in this state when a primitive is waiting on a promise;
     * execution is paused until the promise changes thread status.
     * @const
     */
    static get STATUS_PROMISE_WAIT() {
        return 1; // used by compiler
    }

    /**
     * Thread status for yield.
     * @const
     */
    static get STATUS_YIELD() {
        return 2; // used by compiler
    }

    /**
     * Thread status for a single-tick yield. This will be cleared when the
     * thread is resumed.
     * @const
     */
    static get STATUS_YIELD_TICK() {
        return 3; // used by compiler
    }

    /**
     * Thread status for a finished/done thread.
     * Thread is in this state when there are no more blocks to execute.
     * @const
     */
    static get STATUS_DONE() {
        return 4; // used by compiler
    }

    /**
     * @param {Target} target The target running the thread.
     * @param {string} topBlock ID of the thread's top block.
     * @returns {string} A unique ID for this target and thread.
     */
    static getIdFromTargetAndBlock(target, topBlock) {
        // & should never appear in any IDs, so we can use it as a separator
        return `${target.id}&${topBlock}`;
    }

    step() {
        if (!this.generator) return;
        if (this.status === Thread.STATUS_YIELD) {
            this._status = Thread.STATUS_RUNNING;
        }
        while (this.status === Thread.STATUS_RUNNING) {
            const oldThread = blockUtility.thread;
            try {
                blockUtility.thread = this;
                const v = execute(this, this.promiseResult);
                this.promiseResult[0] = 0;
                if (v.value === Yield) {
                    this._status = Thread.STATUS_YIELD;
                } else if (v.value === YieldTick) {
                    this._status = Thread.STATUS_YIELD_TICK;
                } else if (isPromise(v.value)) {
                    // enter STATUS_PROMISE_WAIT and yield
                    // this will stop script execution until the promise handlers reset the thread status
                    // because promise handlers might execute immediately, configure thread.status here
                    this._status = Thread.STATUS_PROMISE_WAIT;
                    v.value.then(
                        (value) => {
                            this.promiseResult[0] = 1;
                            this.promiseResult[1] = value;
                            this._status = Thread.STATUS_RUNNING;
                        },
                        (error) => {
                            this.promiseResult[0] = 2;
                            this.promiseResult[1] = error;
                            this._status = Thread.STATUS_RUNNING;
                        }
                    );
                } else {
                    this.promiseResult[0] = 1;
                    this.promiseResult[1] = v.value;
                }
                if (v.done) {
                    this.kill();
                }
            } catch (e) {
                if (e === KillThread || e === StopThisScript.instance) {
                    this.kill();
                    return;
                }
                throw e;
            } finally {
                blockUtility.thread = oldThread;
            }
        }
    }

    getId() {
        return Thread.getIdFromTargetAndBlock(this.target, this.topBlock);
    }

    get status() {
        return this._status;
    }

    kill() {
        this.context = null;
        this.requestScriptGlowInFrame = false;
        this._status = Thread.STATUS_DONE;
        this.procedures = null;
        this.generator = null;
    }

    /**
     * Attempt to compile this thread.
     */
    compile(useCompiler) {
        if (!this.blockContainer) {
            return;
        }

        if (useCompiler) {
            // importing the compiler here avoids circular dependency issues
            const compile = require("../compiler/compile");

            this.triedToCompile = true;

            // stackClick === true disables hat block generation
            // It would be great to cache these separately, but for now it's easiest to just disable them to avoid
            // cached versions of scripts breaking projects.
            const canCache = !this.stackClick;

            const topBlock = this.topBlock;
            // Flyout blocks are stored in a special block container.
            const blocks = this.blockContainer.getBlock(topBlock)
                ? this.blockContainer
                : this.target.runtime.flyoutBlocks;
            const cachedResult =
                canCache && blocks.getCachedCompileResult(topBlock);
            // If there is a cached error, do not attempt to recompile.
            if (cachedResult && !cachedResult.success) {
                return;
            }

            let result;
            if (cachedResult) {
                result = cachedResult.value;
            } else {
                try {
                    result = compile(this);
                    if (canCache) {
                        blocks.cacheCompileResult(topBlock, result);
                    }
                } catch (error) {
                    log.error(
                        "cannot compile script",
                        this.target.getName(),
                        error
                    );
                    if (canCache) {
                        blocks.cacheCompileError(topBlock, error);
                    }
                    this.target.runtime.emitCompileError(this.target, error);
                    return;
                }
            }

            this.procedures = {};
            for (const procedureCode of Object.keys(result.procedures)) {
                this.procedures[procedureCode] =
                    result.procedures[procedureCode](this);
            }

            this.generator = result.startingFunction(this)();

            this.executableHat = result.executableHat;

            if (!this.blockContainer.forceNoGlow) {
                this.blockGlowInFrame = this.topBlock;
                this.requestScriptGlowInFrame = true;
            }

            this.isCompiled = true;
        } else {
            this.generator = generate(this.blockContainer, this.topBlock)(this);
        }
    }
}

// for extensions
// Thread._StackFrame = _StackFrame;

module.exports = Thread;
