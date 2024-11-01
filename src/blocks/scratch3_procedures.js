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

        const warpTimer = util.thread.warpTimer;
        yield* util.startProcedure(procedureCode);
        util.thread.warpTimer = warpTimer;
    }

    *return (args, util) {
        return util.stopThisScript(yield* args.VALUE());
    }

    *argumentReporterStringNumber (args, util) {
        if (
            util.context &&
            util.context.param &&
            args.VALUE.value in util.context.param
        ) {
            return util.context.param[args.VALUE.value];
        }
        // tw: support legacy block
        if (String(args.VALUE.value).toLowerCase() === 'last key pressed') {
            return util.ioQuery('keyboard', 'getLastKeyPressed');
        }
        // When the parameter is not found in the most recent procedure
        // call, the default is always 0.
        return 0;
    }

    *argumentReporterBoolean (args, util) {
        if (
            util.context &&
            util.context.param &&
            args.VALUE.value in util.context.param
        ) {
            return util.context.param[args.VALUE.value];
        }
        // tw: implement is compiled? and is turbowarp?
        const lowercaseValue = String(args.VALUE.value).toLowerCase();
        if (
            util.target.runtime.compilerOptions.enabled &&
            lowercaseValue === 'is compiled?'
        ) {
            return true;
        }
        if (lowercaseValue === 'is turbowarp?') {
            return true;
        }
        // When the parameter is not found in the most recent procedure
        // call, the default is always 0.
        return 0;
    }
}

module.exports = Scratch3ProcedureBlocks;
