const reusuableObject = {
    done: true,
    value: undefined,
};

const generatorPrototype = function* () {}.prototype;

const asGenerator = (fn) => {
    return Object.assign(fn, {
        prototype: generatorPrototype,
    });
};
const toGenerator = (fn) => {
    const generatorLike = {
        next: () => {
            reusuableObject.value = fn();
            return reusuableObject;
        },
        [Symbol.iterator]() {
            return this;
        },
    };
    return asGenerator(function () {
        return generatorLike;
    });
};

module.exports = {
    toGenerator,
    asGenerator
};
