import * as Task from "../src/lib.js"
import { assert, createLog, inspect } from "./util.js"

describe("Task.join", () => {
  it("joined tasks delegate messages", async () => {
    const abort = new Error("abort")
    function* work(name = "anonymous") {
      yield* Task.send(name)
      yield* Task.sleep()
    }

    function* main() {
      yield* Task.join([
        Task.fork(work("alice")),
        Task.fork(work("bob")),
        Task.fork(work("jordan")),
      ])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: undefined,
      mail: ["alice", "bob", "jordan"],
    })
  })

  it("failed task fails join", async () => {
    const boom = new Error("boom")

    function* fail() {
      yield* Task.sleep()
      throw boom
    }

    function* succeed(value = 0) {
      yield* Task.sleep()
      return value
    }

    function* main() {
      const ok = Task.fork(succeed(5))
      const error = Task.fork(fail())

      yield* Task.join([ok, error])
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: false,
      error: boom,
      mail: [],
    })
  })

  it("can collect results", async () => {
    function* inc(n = 0) {
      yield* Task.send(n)
      return n + 1
    }

    function* main() {
      const a = Task.fork(inc(5))
      const b = Task.fork(inc(16))

      const result = yield* Task.join([a, b])
      return result
    }

    assert.deepEqual(await Task.fork(inspect(main())), {
      ok: true,
      value: [6, 17],
      mail: [5, 16],
    })
  })
})
