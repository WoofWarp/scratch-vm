const BlockUtility = require('../engine/block-utility');

class CompatibilityLayerBlockUtility extends BlockUtility {

    init (thread) {
        this.thread = thread;
        this.sequencer = thread.target.runtime.sequencer;
        this._startedBranch = null;
    }
}

// Export a single instance to be reused.
module.exports = new CompatibilityLayerBlockUtility();
