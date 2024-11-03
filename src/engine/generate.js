const BlocksExecuteCache = require("./blocks-execute-cache");
// const log = require('../util/log');
// const Thread = require('./thread');
const { Map } = require("immutable");
// const cast = require("../util/cast");
const blockUtility = require('./block-utility-instance');
const { KillThread } = require("./thread-status");

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
    constructor(blockContainer, cached) {
        /** @type {@import('./runtime')} */
        const runtime = blockContainer.runtime;
        this.args = Object.assign({}, cached.fields);
        for (const input of Object.values(cached.inputs)) {
            if (input.block) {
                const inputBlock = blockContainer.getBlock(input.block);
                if (inputBlock.next) {
                    this.args[input.name] = function* evaluate() {
                        const backupThread = blockUtility.thread;
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
                this.compiled = function* evaluate() {
                    // TODO: if blockFunction is not a generator, precalculate all params
                    // const backupThread = blockUtility.thread;
                    const result = yield* this.blockFunction(
                        this.args,
                        blockUtility
                    );
                    // blockUtility.thread = backupThread;
                    return result;
                }.bind(this);
            } else {
                this.compiled = function* evaluate() {
                    return this.blockFunction(this.args, blockUtility);
                }.bind(this);
            }
        } else if (this.isHat) {
            this.compiled = function* constant() {
                return true;
            };
        } else if (this.shadow) {
            this.compiled = function* constant() {
                return Object.values(this.args)[0].value;
            }.bind(this);
        } else throw new Error(`Error while finding opcode ${this.opcode}`);
    }
}

class ScriptCached {
    constructor(blockContainer, cached) {
        this.topBlock = cached.id;
        this.block = cached;
        if (!cached.next) {
            this.compiled = function* command(thread) {
                /** @type {import('./runtime')} */
                const runtime = blockContainer.runtime;
                let block = this.block;
                let result;
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
                    // const oldThread = blockUtility.thread;
                    blockUtility.thread = thread;
                    result = yield* cache.compiled();
                    // blockUtility.thread = oldThread;
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
                                const edgeWasActivated = hasOldEdgeValue
                                    ? !oldEdgeValue && result
                                    : result;
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
                        typeof result !== "undefined" &&
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
                                    spriteName: targetId
                                        ? runtime
                                              .getTargetById(targetId)
                                              .getName()
                                        : null,
                                    value: result,
                                })
                            );
                        }
                    }
                    return cache.isHat ? void 0 : result;
            }.bind(this);
        } else {
            this.compiled = function* substack(thread) {
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
                    // const oldThread = blockUtility.thread;
                    blockUtility.thread = thread;
                    result = yield* cache.compiled();
                    // blockUtility.thread = oldThread;
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
                                const edgeWasActivated = hasOldEdgeValue
                                    ? !oldEdgeValue && result
                                    : result;
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
        }
    }
}

/**
 *
 * @param {Thread} thread
 * @param {import('./blocks')} blockContainer
 * @param {string} topBlockId
 * @returns
 */
const generate = (blockContainer, topBlockId) => {
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
