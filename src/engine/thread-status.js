const Yield = Symbol('Yield');
const YieldTick = Symbol('YieldTick');
const KillThread = Symbol('KillThread');
class StopThisScript {
    static instance = new StopThisScript();
    /**
     *
     * @param {*} value
     */
    constructor (value) {
        this.value = value;
    }
}
module.exports = {Yield, YieldTick, KillThread, StopThisScript};
