const BlocksExecuteCache = require('./blocks-execute-cache');
// const log = require('../util/log');
// const Thread = require('./thread');
const {Map} = require('immutable');
// const cast = require("../util/cast");
const blockUtility = require('./block-utility-instance');
const {KillThread} = require('./thread-status');

/**
 * A execute.js internal representation of a block to reduce the time spent in
 * execute as the same blocks are called the most.
 *
 * With the help of the Blocks class create a mutable copy of block
 * information. The members of BlockCached derived values of block information
 * that does not need to be reevaluated until a change in Blocks. Since Blocks
 * handles where the cache instance is stored, it drops all cache versions of a
 * block when any change happens to it. This way we can quickly execute blocks
 * and keep perform the right action according to the current block information
 * in the editor.
 *
 * @param {Blocks} blockContainer the related Blocks instance
 * @param {object} cached default set of cached values
 */
class BlockCached {
    constructor (blockContainer, cached) {
        /** @type {import('./runtime')} */
        const runtime = blockContainer.runtime;
        this.args = {...cached.fields};
        for (const input of Object.values(cached.inputs)) {
            if (input.block) {
                const inputBlock = blockContainer.getBlock(input.block);
                if (inputBlock.next) {
                    this.args[input.name] = function* evaluate () {
                        const backupThread = blockUtility.thread;
                        // eslint-disable-next-line no-use-before-define
                        const res = yield* generate(
                            blockContainer,
                            input.block
                        )(
                            backupThread
                        );
                        // blockUtility.thread = backupThread;
                        return res;
                    };
                } else {
                    const cache = BlocksExecuteCache.getCached(
                        blockContainer,
                        input.block,
                        BlockCached
                    );
                    this.args[input.name] = cache.compiled;
                }
            }
        }
        if (cached.mutation) this.args.mutation = cached.mutation;
        this.opcode = cached.opcode;
        this.blockFunction = runtime.getOpcodeFunction(cached.opcode);
        this.shadow = cached.shadow;
        this.isHat = runtime.getIsHat(cached.opcode);
        if (this.blockFunction) {
            if (this.blockFunction instanceof function* () {}.constructor) {
                // TODO: if blockFunction is not a generator, precalculate all params
                this.compiled = this.blockFunction.bind(null, this.args, blockUtility);
            } else {
                // eslint-disable-next-line require-yield
                this.compiled = function* evaluate () {
                    return this.blockFunction(this.args, blockUtility);
                }.bind(this);
            }
        } else if (this.isHat) {
            // eslint-disable-next-line require-yield
            this.compiled = function* constant () {
                return true;
            };
        } else if (this.shadow) {
            // TODO: optimize it.
            // eslint-disable-next-line require-yield
            this.compiled = function* constant () {
                return Object.values(this.args)[0].value;
            }.bind(this);
        } else throw new Error(`Error while finding opcode ${this.opcode}`);
    }
}

class ScriptCached {
    constructor (blockContainer, cached) {
        this.topBlock = cached.id;
        this.block = cached;
        // TODO: the algorithms here are similar.
        // I am not sure if convert them into one function hurts performance or not.
        if (cached.next) {
            this.compiled = function* substack (thread) {
                /** @type {import('./runtime')} */
                const runtime = blockContainer.runtime;
                let block = this.block;
                let firstTick = true;
                let result;
                while (1) {
                    const cache =
                        BlocksExecuteCache.getCached(
                            blockContainer,
                            block.id,
                            BlockCached
                        ) ??
                        BlocksExecuteCache.getCached(
                            runtime.flyoutBlocks,
                            block.id,
                            BlockCached
                        );
                    if (!blockContainer.forceNoGlow) {
                        thread.requestScriptGlowInFrame = true;
                    }
                    thread.blockGlowInFrame = block.id;
                    blockUtility.thread = thread;
                    result = yield* cache.compiled();
                    if (thread.isKilled) throw KillThread;
                    if (cache.isHat && firstTick) {
                        if (runtime.getIsEdgeActivatedHat(block.opcode)) {
                            if (!thread.stackClick) {
                                const hasOldEdgeValue =
                                    thread.target.hasEdgeActivatedValue(
                                        block.id
                                    );
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
                        yield blockUtility.yield();
                    }
                    if (block.next) {
                        block = blockContainer.getBlock(block.next);
                        firstTick = false;
                    } else {
                        return cache.isHat ? void 0 : result;
                    }
                }
            }.bind(this);
        } else {
            this.compiled = function* command (thread) {
                /** @type {import('./runtime')} */
                const runtime = blockContainer.runtime;
                const block = this.block;
                const cache =
                        BlocksExecuteCache.getCached(
                            blockContainer,
                            block.id,
                            BlockCached
                        ) ??
                        BlocksExecuteCache.getCached(
                            runtime.flyoutBlocks,
                            block.id,
                            BlockCached
                        );
                if (!blockContainer.forceNoGlow) {
                    thread.requestScriptGlowInFrame = true;
                }
                thread.blockGlowInFrame = block.id;
                blockUtility.thread = thread;
                const result = yield* cache.compiled();
                if (thread.isKilled) throw KillThread;
                if (cache.isHat) {
                    if (runtime.getIsEdgeActivatedHat(block.opcode)) {
                        if (!thread.stackClick) {
                            const hasOldEdgeValue =
                                    thread.target.hasEdgeActivatedValue(
                                        block.id
                                    );
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
                    yield blockUtility.yield();
                }
                if (
                    !(cache.isHat) &&
                        typeof result !== 'undefined' &&
                        this.topBlock === thread.topBlock
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
                                    runtime
                                        .getTargetById(targetId)
                                        .getName() :
                                    null,
                                value: result
                            })
                        );
                    }
                }
                return cache.isHat ? void 0 : result;
            }.bind(this);
        }
    }
}

/**
 * @param {import('./blocks')} blockContainer
 * @param {string} topBlockId
 * @returns
 */
const generate = (blockContainer, topBlockId) => {
    // TODO: live editing
    const cache =
        BlocksExecuteCache.getScriptCached(
            blockContainer,
            topBlockId,
            ScriptCached
        ) ??
        BlocksExecuteCache.getScriptCached(
            blockContainer.runtime.flyoutBlocks,
            topBlockId,
            ScriptCached
        );
    return cache.compiled;
};

module.exports = generate;
