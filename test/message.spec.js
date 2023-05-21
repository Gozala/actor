import * as Task from "../src/scratch.js"
import { assert, inspect } from "./util.js"

describe("messaging", () => {
  it("can send message", async () => {
    function* main() {
      yield* Task.send("one")
      yield* Task.send("two")
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two"],
    })
  })

  it("can send message in finally", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
      } finally {
        yield* Task.send("three")
      }
    }
    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two", "three"],
    })
  })
  it("can send message after exception", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        // yield * Task.wait(Promise.reject('boom'))
        throw "boom"
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    }
    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("four")
      }
    }
    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two"],
    })
  })

  it("subtasks can send messages", async () => {
    function* worker() {
      yield* Task.send("c1")
    }

    function* main() {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* worker()
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("five")
      }
    }

    const result = await Task.fork(inspect(main()))

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two", "c1", "three", "four"],
    })
  })
})
