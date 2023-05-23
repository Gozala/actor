// @ts-nocheck
import * as Task from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe.skip("tag", () => {
  it("tags effect", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(2)

      yield* Task.send(2)
    }

    const result = await Task.fork(inspect(Task.tag(fx(), "fx")))
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [
        { type: "fx", fx: 1 },
        { type: "fx", fx: 2 },
      ],
    })
  })

  it("tags with errors", async () => {
    const error = new Error("boom")
    function* fx() {
      yield* Task.send(1)
      throw error
    }

    function* main() {
      yield* Task.tag(fx(), "fx")
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error,
      mail: [{ type: "fx", fx: 1 }],
    })
  })

  it("can exit tagged", async () => {
    const { output, log } = createLog()
    function* fx() {
      yield* Task.send(1)
      log("send 1")
      yield* Task.sleep(1)
      yield* Task.send(2)
      log("send 2")
    }

    function* main() {
      const fork = Task.fork(Task.tag(fx(), "fx"))
      yield* Task.sleep(1)
      yield* fork.exit().join()
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["send 1"])
    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["send 1"])
  })

  it("can abort tagged", async () => {
    const { output, log } = createLog()
    function* fx() {
      yield* Task.send(1)
      log("send 1")
      yield* Task.sleep(1)
      yield* Task.send(2)
      log("send 2")
    }

    function* main() {
      const tagged = Task.tag(fx(), "fx")
      assert.equal(String(tagged), "[object TaggedEffect]")
      const fork = Task.fork(tagged)
      yield* Task.sleep(1)
      yield* fork.abort(new Error("kill")).join()
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.deepEqual(output, ["send 1"])
    await Task.fork(Task.sleep(5))

    assert.deepEqual(output, ["send 1"])
  })

  it("can double tag", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(1)
      yield* Task.send(2)
    }

    const tagged = Task.tag(Task.tag(fx(), "foo"), "bar")

    assert.deepEqual(await Task.fork(inspect(tagged)), {
      ok: true,
      value: undefined,
      mail: [
        { type: "bar", bar: { type: "foo", foo: 1 } },
        { type: "bar", bar: { type: "foo", foo: 2 } },
      ],
    })
  })

  it("tagging none is noop", async () => {
    function* fx() {
      yield* Task.send(1)
      yield* Task.sleep(1)
      yield* Task.send(2)
    }

    const tagged = Task.tag(Task.tag(Task.none(), "foo"), "bar")
    assert.deepEqual(await Task.fork(inspect(tagged)), {
      ok: true,
      value: undefined,
      mail: [],
    })
    assert.equal(tagged, Task.none())
  })
})
