const Cast = require('../util/cast');

class Scratch3EventBlocks {
    constructor (runtime) {
        /**
         * The runtime instantiating this block package.
         * @type {Runtime}
         */
        this.runtime = runtime;

        this.runtime.on('KEY_PRESSED', key => {
            this.runtime.startHats('event_whenkeypressed', {
                KEY_OPTION: key
            });
            this.runtime.startHats('event_whenkeypressed', {
                KEY_OPTION: 'any'
            });
        });
    }

    /**
     * Retrieve the block primitives implemented by this package.
     * @return {object.<string, Function>} Mapping of opcode to Function.
     */
    getPrimitives () {
        return {
            event_whentouchingobject: this.touchingObject,
            event_broadcast: this.broadcast,
            event_broadcastandwait: this.broadcastAndWait,
            event_whengreaterthan: this.hatGreaterThanPredicate,
            event_broadcast_menu: this.broadcastMenu
        };
    }

    getHats () {
        return {
            event_whenflagclicked: {
                restartExistingThreads: true
            },
            event_whenkeypressed: {
                restartExistingThreads: false
            },
            event_whenthisspriteclicked: {
                restartExistingThreads: true
            },
            event_whentouchingobject: {
                restartExistingThreads: false,
                edgeActivated: true
            },
            event_whenstageclicked: {
                restartExistingThreads: true
            },
            event_whenbackdropswitchesto: {
                restartExistingThreads: true
            },
            event_whengreaterthan: {
                restartExistingThreads: false,
                edgeActivated: true
            },
            event_whenbroadcastreceived: {
                restartExistingThreads: true
            }
        };
    }

    *touchingObject (args, util) {
        return util.target.isTouchingObject(yield* args.TOUCHINGOBJECTMENU());
    }

    *hatGreaterThanPredicate (args, util) {
        const option = Cast.toString(
            args.WHENGREATERTHANMENU.value
        ).toLowerCase();
        const value = Cast.toNumber(yield* args.VALUE());
        switch (option) {
        case 'timer':
            return util.ioQuery('clock', 'projectTimer') > value;
        case 'loudness':
            return (
                this.runtime.audioEngine &&
                    this.runtime.audioEngine.getLoudness() > value
            );
        }
        return false;
    }

    *broadcast (args, util) {
        let broadcastVar = null;
        const val = yield* args.BROADCAST_INPUT();
        if (typeof val === 'object') {
            broadcastVar = util.runtime
                .getTargetForStage()
                .lookupBroadcastMsg(
                    val.id,
                    val.name
                );
        } else {
            broadcastVar = util.runtime
                .getTargetForStage()
                .lookupBroadcastMsg(null, val);
        }
        if (broadcastVar) {
            const broadcastOption = broadcastVar.name;
            util.startHats('event_whenbroadcastreceived', {
                BROADCAST_OPTION: broadcastOption
            });
        }
    }

    *broadcastMenu (args) {
        return args.BROADCAST_OPTION;
    }

    *broadcastAndWait (args, util) {
        let broadcastVar = null;
        const val = yield* args.BROADCAST_INPUT();
        if (typeof val === 'object') {
            broadcastVar = util.runtime
                .getTargetForStage()
                .lookupBroadcastMsg(
                    val.id,
                    val.name
                );
        } else {
            broadcastVar = util.runtime
                .getTargetForStage()
                .lookupBroadcastMsg(null, val);
        }
        if (broadcastVar) {
            const broadcastOption = broadcastVar.name;
            const startedThreads = util.startHats(
                'event_whenbroadcastreceived',
                {
                    BROADCAST_OPTION: broadcastOption
                }
            );
            if (startedThreads.length === 0) return;
            while (
                startedThreads.some(
                    thread => this.runtime.threads.indexOf(thread) !== -1
                )
            ) {
                if (
                    startedThreads.every(thread =>
                        this.runtime.isWaitingThread(thread)
                    )
                ) {
                    yield util.yieldTick();
                } else {
                    yield util.yield();
                }
            }
        }
    }
}

module.exports = Scratch3EventBlocks;
