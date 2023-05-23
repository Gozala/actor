import { Task } from "../src/lib.js"
import { assert, inspect, createLog } from "./util.js"

describe("Task.all", () => {
  it("can get all results", async () => {
    const { output, log } = createLog()

    /** @type {(d:number, r:string) => Task.Task<string, never>} */
    function* work(duration, result) {
      yield* Task.sleep(duration)
      log(result)
      return result
    }

    function* main() {
      const result = yield* Task.all([
        work(2, "a"),
        work(9, "b"),
        work(5, "c"),
        work(0, "d"),
      ])

      return result
    }

    const result = await Task.fork(main())
    assert.deepEqual(result, ["a", "b", "c", "d"])
    assert.notDeepEqual(result, output)
    assert.deepEqual([...result].sort(), [...output].sort())
  })

  it("on failure all other tasks are aborted", async () => {
    const { output, log } = createLog()

    /** @type {(d:number, n:string, c?:boolean) => Task.Task<string, never>} */
    function* work(duration, name, crash = false) {
      yield* Task.sleep(duration)
      log(name)
      if (crash) {
        throw name
      } else {
        return name
      }
    }

    function* main() {
      const result = yield* Task.all([
        work(2, "a"),
        work(9, "b"),
        work(5, "c", true),
        work(0, "d"),
        work(8, "e"),
      ])

      return result
    }

    const result = await Task.fork(inspect(main()))
    assert.deepEqual(result, {
      ok: false,
      error: "c",
      mail: [],
    })

    await Task.fork(Task.sleep(20))
    assert.deepEqual([...output].sort(), ["d", "a", "c"].sort())
  })

  it("can make all of none", async () => {
    assert.deepEqual(
      await Task.fork(
        Task.all(
          // @ts-expect-error - expect one task
          []
        )
      ),
      []
    )
  })
})
