const BlockUtility = require('./block-utility');
// const BlocksExecuteCache = require('./blocks-execute-cache');
// const log = require('../util/log');
// const Thread = require('./thread');
const {Map} = require('immutable');
const {Yield} = require('./thread-status');
// const cast = require("../util/cast");

/**
 * Single BlockUtility instance reused by execute for every pritimive ran.
 * @const
 */
const blockUtility = new BlockUtility();

/**
 *
 * @param {Thread} thread
 * @param {import('./blocks')} blockContainer
 * @param {string} topBlockId
 * @returns
 */
const generate = (blockContainer, topBlockId) =>
    function* (thread, context = null) {
        let block =
            blockContainer.getBlock(topBlockId) ??
            blockContainer.runtime.flyoutBlocks.getBlock(topBlockId);
        /** @type {import('./runtime')} */
        const runtime = thread.target.runtime;
        let result;
        while (1) {
            const blockFunction = runtime.getOpcodeFunction(block.opcode);
            const isHat = runtime.getIsHat(block.opcode);
            const args = {};
            for (const field of Object.values(block.fields)) {
                args[field.name] = field;
            }
            for (const input of Object.values(block.inputs)) {
                if (input.block) {
                    args[input.name] = function* (additionalContext = null) {
                        return yield* generate(blockContainer, input.block)(thread, additionalContext ?? context);
                    };
                }
            }
            args.mutation = block.mutation;
            if (!blockContainer.forceNoGlow) {
                thread.requestScriptGlowInFrame = true;
            }
            thread.blockGlowInFrame = block.id;
            blockUtility.thread = thread;
            blockUtility.context = context;
            if (blockFunction) {
                result = yield* blockFunction(args, blockUtility);
            } else if (isHat) {
                result = true;
            } else if (block.shadow) {
                result = Object.values(block.fields)[0].value;
            } else {
                throw new Error(`Error while finding opcode ${block.opcode}`);
            }
            if (isHat) {
                if (runtime.getIsEdgeActivatedHat(block.opcode)) {
                    if (!thread.stackClick) {
                        const hasOldEdgeValue =
                            thread.target.hasEdgeActivatedValue(block.id);
                        const oldEdgeValue =
                            thread.target.updateEdgeActivatedValue(
                                block.id,
                                result
                            );
                        const edgeWasActivated = hasOldEdgeValue ?
                            !oldEdgeValue && result :
                            result;
                        if (!edgeWasActivated) {
                            return; // retire thread
                        }
                    }
                } else if (!result) {
                    return; // retire thread
                }
                yield new Yield();
            }
            if (
                !isHat &&
                !block.next &&
                typeof result !== 'undefined' &&
                topBlockId === thread.topBlock
            ) {
                if (thread.stackClick) {
                    runtime.visualReport(block.id, result);
                }
                if (thread.updateMonitor) {
                    const targetId = runtime.monitorBlocks.getBlock(
                        block.id
                    ).targetId;
                    if (targetId && !runtime.getTargetById(targetId)) {
                        // Target no longer exists
                        return;
                    }
                    runtime.requestUpdateMonitor(
                        Map({
                            id: block.id,
                            spriteName: targetId ?
                                runtime.getTargetById(targetId).getName() :
                                null,
                            value: result
                        })
                    );
                }
            }
            if (block.next) {
                block = blockContainer.getBlock(block.next);
            } else {
                return isHat ? void 0 : result;
            }
        }
        // TODO: do something here like stepThread
    };

module.exports = generate;
