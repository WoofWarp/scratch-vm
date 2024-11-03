const {StopThisScript} = require('../engine/thread-status');
const Timer = require('../util/timer');

class Scratch3ProcedureBlocks {
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
            procedures_definition: this.definition,
            procedures_call: this.call,
            procedures_return: this.return,
            argument_reporter_string_number: this.argumentReporterStringNumber,
            argument_reporter_boolean: this.argumentReporterBoolean
        };
    }

    *definition () {
        // No-op: execute the blocks.
    }
    
    /**
     * Step a procedure.
     * @param {!string} procedureCode Procedure code of procedure to step to.
     */
    *startProcedure (procedureCode, params, thread, context, util) {
        const generate = require('../engine/generate');
        const Sequencer = require('../engine/sequencer');

        const definition =
            thread.target.blocks.getProcedureDefinition(procedureCode); // for recursive check
        if (!definition) {
            return;
        }
        const generator = generate(thread.target.blocks, definition);

        const procedureStack = context?.procStack ?? [];

        // Check if the call is recursive.
        // If so, set the thread to yield after pushing.
        const isRecursive = procedureStack.includes(definition); // This is configurable

        procedureStack.push(definition);

        // To step to a procedure, we put its definition on the stack.
        // Execution for the thread will proceed through the definition hat
        // and on to the main definition of the procedure.
        // When that set of blocks finishes executing, it will be popped
        // from the stack by the sequencer, returning control to the caller.
        // thread.pushStack(definition);
        // In known warp-mode threads, only yield when time is up.
        if (
            thread.warpTimer &&
            thread.warpTimer.timeElapsed() > Sequencer.WARP_TIME
        ) {
            yield util.yield();
        } else {
            // Look for warp-mode flag on definition, and set the thread
            // to warp-mode if needed.
            const definitionBlock =
                thread.target.blocks.getBlock(definition);
            const innerBlock = thread.target.blocks.getBlock(
                definitionBlock.inputs.custom_block.block
            );
            let doWarp = false;
            if (innerBlock && innerBlock.mutation) {
                const warp = innerBlock.mutation.warp;
                if (typeof warp === 'boolean') {
                    doWarp = warp;
                } else if (typeof warp === 'string') {
                    doWarp = JSON.parse(warp);
                }
            }
            if (doWarp) {
                thread.warpTimer = new Timer();
                thread.warpTimer.start();
            } else if (isRecursive) {
                // In normal-mode threads, yield any time we have a recursive call.
                yield util.yield();
            }
        }
        const newContext = Object.assign({}, context, {
            params,
            procStack: procedureStack
        });
        // eslint-disable-next-line require-atomic-updates
        thread.context = newContext;
        try {
            yield* generator(
                thread
            );
        } finally {
            // eslint-disable-next-line require-atomic-updates
            thread.context = context;
            procedureStack.pop();
        }
    }

    *call (args, util) {
        const isReporter = !!args.mutation.return;

        const procedureCode = args.mutation.proccode;
        const paramNamesIdsAndDefaults =
            util.getProcedureParamNamesIdsAndDefaults(procedureCode);

        if (paramNamesIdsAndDefaults === null) {
            if (isReporter) {
                return '';
            }
            return;
        }

        // if (stackFrame.executed) {
        //     if (isReporter) {
        //         const returnValue = stackFrame.returnValue;
        //         // This stackframe will be reused for other reporters in this block, so clean it up for them.
        //         // Can't use reset() because that will reset too much.
        //         const threadStackFrame = util.thread.peekStackFrame();
        //         threadStackFrame.params = null;
        //         delete stackFrame.returnValue;
        //         delete stackFrame.executed;
        //         return returnValue;
        //     }
        //     return;
        // }

        // const procedureCode = args.mutation.proccode;
        // const paramNamesIdsAndDefaults = util.getProcedureParamNamesIdsAndDefaults(procedureCode);

        // If null, procedure could not be found, which can happen if custom
        // block is dragged between sprites without the definition.
        // Match Scratch 2.0 behavior and noop.
        if (paramNamesIdsAndDefaults === null) {
            if (isReporter) {
                return '';
            }
            return;
        }

        const [paramNames, paramIds, paramDefaults] = paramNamesIdsAndDefaults;
        
        const thread = util.thread;
        const context = thread.context;

        // Initialize params for the current stackFrame to {}, even if the procedure does
        // not take any arguments. This is so that `getParam` down the line does not look
        // at earlier stack frames for the values of a given parameter (#1729)
        const params = {};
        for (let i = 0; i < paramIds.length; i++) {
            if (Object.prototype.hasOwnProperty.call(args, paramIds[i])) {
                params[paramNames[i]] = yield* args[paramIds[i]]();
            } else {
                params[paramNames[i]] = paramDefaults[i];
            }
        }

        const addonBlock = util.runtime.getAddonBlock(procedureCode);
        if (addonBlock) {
            const result = yield* addonBlock.callback(params, util);
            return result;
        }

        const warpTimer = thread.warpTimer;
        try {
            yield* this.startProcedure(procedureCode, params, thread, context, util);
        } catch (e) {
            if (e === StopThisScript.instance) return e.value ?? '';
            throw e;
        } finally {
            thread.warpTimer = warpTimer;
        }
        if (isReporter) return '';
    }

    *return (args, util) {
        return util.stopThisScript(yield* args.VALUE());
    }

    argumentReporterStringNumber (args, util) {
        const value = util.getParam(args.VALUE.value);
        if (value === null) {
            // tw: support legacy block
            if (String(args.VALUE.value).toLowerCase() === 'last key pressed') {
                return util.ioQuery('keyboard', 'getLastKeyPressed');
            }
            // When the parameter is not found in the most recent procedure
            // call, the default is always 0.
            return 0;
        }
        return value;
    }

    argumentReporterBoolean (args, util) {
        const value = util.getParam(args.VALUE.value);
        if (value === null) {
            // tw: implement is compiled? and is turbowarp?
            const lowercaseValue = String(args.VALUE.value).toLowerCase();
            if (util.target.runtime.compilerOptions.enabled && lowercaseValue === 'is compiled?') {
                return true;
            }
            if (lowercaseValue === 'is turbowarp?') {
                return true;
            }
            // When the parameter is not found in the most recent procedure
            // call, the default is always 0.
            return 0;
        }
        return value;
    }
}

module.exports = Scratch3ProcedureBlocks;
