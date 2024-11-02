// const Thread = require('./thread');
// const Timer = require('../util/timer');
const { StopThisScript, Yield, YieldTick } = require("./thread-status");
const Timer = require("../util/timer");

const yieldInstance = new Yield();
const yieldTickInstance = new YieldTick();

/**
 * @fileoverview
 * Interface provided to block primitive functions for interacting with the
 * runtime, thread, target, and convenient methods.
 */

class BlockUtility {
    constructor(thread = null) {
        this.context = null;

        /**
         * The block primitives thread with the block's target, stackFrame and
         * modifiable status.
         * @type {?import('./thread')}
         */
        this.thread = thread;

        this._nowObj = {
            now: () => this.thread.target.runtime.currentMSecs,
        };
    }

    /**
     * The target the primitive is working on.
     * @type {Target}
     */
    get target() {
        return this.thread.target;
    }

    /**
     * The runtime the block primitive is running in.
     * @type {Runtime}
     */
    get runtime() {
        return this.thread.target.runtime;
    }

    /**
     * Use the runtime's currentMSecs value as a timestamp value for now
     * This is useful in some cases where we need compatibility with Scratch 2
     * @type {function}
     */
    get nowObj() {
        if (this.runtime) {
            return this._nowObj;
        }
        return null;
    }

    /**
     * Set the thread to yield.
     */
    yield() {
        return yieldInstance;
    }

    /**
     * Set the thread to yield until the next tick of the runtime.
     */
    yieldTick() {
        return yieldTickInstance;
    }

    /**
     * Stop all threads.
     */
    stopAll() {
        this.thread.target.runtime.stopAll();
    }

    /**
     * Stop threads other on this target other than the thread holding the
     * executed block.
     */
    stopOtherTargetThreads() {
        this.thread.target.runtime.stopForTarget(
            this.thread.target,
            this.thread
        );
    }

    stopThisScript(value) {
        throw new StopThisScript(value);
    }

    /**
     * Create and start a timer.
     * @returns {Timer} - the timer that was created and started.
     */
    startTimer() {
        const timer = this.nowObj ? new Timer(this.nowObj) : new Timer();
        timer.start();
        return timer;
    }

    /**
     * Retrieve the stored parameter value for a given parameter name.
     * @param {string} paramName The procedure's parameter name.
     * @return {*} The parameter's current stored value.
     */
    getParam(paramName) {
        return this.context?.params?.[paramName] ?? null;
    }

    /**
     * Step a procedure.
     * @param {!string} procedureCode Procedure code of procedure to step to.
     */
    *startProcedure(procedureCode, params) {
        const generate = require("./generate");
        const Sequencer = require("./sequencer");
        const definition =
            this.thread.target.blocks.getProcedureDefinition(procedureCode); // for recursive check
        if (!definition) {
            return;
        }
        const generator = generate(this.thread.blockContainer, definition);

        const procedureStack = this.context?.procStack ?? [];

        const isRecursive = procedureStack.slice(-6).includes(definition);

        procedureStack.push(definition);

        // TODO: check call recursive

        // Check if the call is recursive.
        // If so, set the thread to yield after pushing.
        // const isRecursive = this.thread.isRecursiveCall(procedureCode);

        // To step to a procedure, we put its definition on the stack.
        // Execution for the thread will proceed through the definition hat
        // and on to the main definition of the procedure.
        // When that set of blocks finishes executing, it will be popped
        // from the stack by the sequencer, returning control to the caller.
        // thread.pushStack(definition);
        // In known warp-mode threads, only yield when time is up.
        if (
            this.thread.warpTimer &&
            this.thread.warpTimer.timeElapsed() > Sequencer.WARP_TIME
        ) {
            yield this.yield();
        } else {
            // Look for warp-mode flag on definition, and set the thread
            // to warp-mode if needed.
            const definitionBlock =
                this.thread.target.blocks.getBlock(definition);
            const innerBlock = this.thread.target.blocks.getBlock(
                definitionBlock.inputs.custom_block.block
            );
            let doWarp = false;
            if (innerBlock && innerBlock.mutation) {
                const warp = innerBlock.mutation.warp;
                if (typeof warp === "boolean") {
                    doWarp = warp;
                } else if (typeof warp === "string") {
                    doWarp = JSON.parse(warp);
                }
            }
            if (doWarp) {
                this.thread.warpTimer = new Timer();
                this.thread.warpTimer.start();
            } else if (isRecursive) {
                // In normal-mode threads, yield any time we have a recursive call.
                yield this.yield();
            }
        }
        return yield* generator(
            this.thread,
            Object.assign({}, this.context, {
                params: Object.assign({}, this.context?.params, params),
                procStack: procedureStack,
            })
        );
        // else if (isRecursive) {
        //     // In normal-mode threads, yield any time we have a recursive call.
        //     thread.status = Thread.STATUS_YIELD;
        // }
    }

    /**
     * Get names and ids of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesAndIds(procedureCode) {
        return this.thread.target.blocks.getProcedureParamNamesAndIds(
            procedureCode
        );
    }

    /**
     * Get names, ids, and defaults of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesIdsAndDefaults(procedureCode) {
        return this.thread.target.blocks.getProcedureParamNamesIdsAndDefaults(
            procedureCode
        );
    }

    /**
     * Start all relevant hats.
     * @param {!string} requestedHat Opcode of hats to start.
     * @param {object=} optMatchFields Optionally, fields to match on the hat.
     * @param {Target=} optTarget Optionally, a target to restrict to.
     * @return {Array.<Thread>} List of threads started by this function.
     */
    startHats(requestedHat, optMatchFields, optTarget) {
        // Store thread and sequencer to ensure we can return to the calling block's context.
        // startHats may execute further blocks and dirty the BlockUtility's execution context
        // and confuse the calling block when we return to it.
        const callerThread = this.thread;
        const result = this.thread.target.runtime.startHats(
            requestedHat,
            optMatchFields,
            optTarget
        );

        // Restore thread and sequencer to prior values before we return to the calling block.
        this.thread = callerThread;

        return result;
    }

    /**
     * Query a named IO device.
     * @param {string} device The name of like the device, like keyboard.
     * @param {string} func The name of the device's function to query.
     * @param {Array.<*>} args Arguments to pass to the device's function.
     * @return {*} The expected output for the device's function.
     */
    ioQuery(device, func, args) {
        // Find the I/O device and execute the query/function call.
        if (
            this.thread.target.runtime.ioDevices[device] &&
            this.thread.target.runtime.ioDevices[device][func]
        ) {
            const devObject = this.thread.target.runtime.ioDevices[device];
            // TODO: verify correct `this` after switching from apply to spread
            // eslint-disable-next-line prefer-spread
            return devObject[func].apply(devObject, args);
        }
    }
}

module.exports = BlockUtility;
