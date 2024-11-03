// const Thread = require('./thread');
// const Timer = require('../util/timer');
const {StopThisScript, Yield, YieldTick} = require('./thread-status');
const Timer = require('../util/timer');

/**
 * @fileoverview
 * Interface provided to block primitive functions for interacting with the
 * runtime, thread, target, and convenient methods.
 */

class BlockUtility {
    constructor (thread = null) {
        /**
         * The block primitives thread with the block's target, stackFrame and
         * modifiable status.
         * @type {?import('./thread')}
         */
        this.thread = thread;

        this._nowObj = {
            now: () => this.thread.target.runtime.currentMSecs
        };
    }

    get context () {
        return this.thread.context;
    }

    /**
     * The target the primitive is working on.
     * @type {Target}
     */
    get target () {
        return this.thread.target;
    }

    /**
     * The runtime the block primitive is running in.
     * @type {Runtime}
     */
    get runtime () {
        return this.thread.target.runtime;
    }

    /**
     * Use the runtime's currentMSecs value as a timestamp value for now
     * This is useful in some cases where we need compatibility with Scratch 2
     * @type {function}
     */
    get nowObj () {
        if (this.runtime) {
            return this._nowObj;
        }
        return null;
    }

    /**
     * Set the thread to yield.
     */
    yield () {
        return Yield;
    }

    /**
     * Set the thread to yield until the next tick of the runtime.
     */
    yieldTick () {
        return YieldTick;
    }

    /**
     * Stop all threads.
     */
    stopAll () {
        this.thread.target.runtime.stopAll();
    }

    /**
     * Stop threads other on this target other than the thread holding the
     * executed block.
     */
    stopOtherTargetThreads () {
        this.thread.target.runtime.stopForTarget(
            this.thread.target,
            this.thread
        );
    }

    stopThisScript (value) {
        StopThisScript.instance.value = value;
        throw StopThisScript.instance;
    }

    /**
     * Create and start a timer.
     * @returns {Timer} - the timer that was created and started.
     */
    startTimer () {
        const timer = this.nowObj ? new Timer(this.nowObj) : new Timer();
        timer.start();
        return timer;
    }

    /**
     * Retrieve the stored parameter value for a given parameter name.
     * @param {string} paramName The procedure's parameter name.
     * @return {*} The parameter's current stored value.
     */
    getParam (paramName) {
        return this.context?.params?.[paramName] ?? null;
    }

    /**
     * Get names and ids of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesAndIds (procedureCode) {
        return this.thread.target.blocks.getProcedureParamNamesAndIds(
            procedureCode
        );
    }

    /**
     * Get names, ids, and defaults of parameters for the given procedure.
     * @param {string} procedureCode Procedure code for procedure to query.
     * @return {Array.<string>} List of param names for a procedure.
     */
    getProcedureParamNamesIdsAndDefaults (procedureCode) {
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
    startHats (requestedHat, optMatchFields, optTarget) {
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
    ioQuery (device, func, args) {
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
