import * as Task from "../src/next.js"
import { assert, inspect, createLog } from "./util.js"

describe("Task.spawn", () => {
  it("can spawn a task", async () => {
    const { output, log } = createLog()
    function* worker() {
      log("> start worker")
      yield* Task.send("hello")
      log("< end worker")
    }

    Task.spawn(worker())
    assert.deepEqual(output, [])
    await Task.perform(Task.tick())
    assert.deepEqual(output, ["> start worker", "< end worker"])
  })

  it("can exit spawn task", async () => {
    const { output, log } = createLog()
    function* worker(count = 0) {
      log("> start worker")
      let n = 0
      while (n < count) {
        yield* Task.sleep(2)
        log(`>> ${n}`)
        yield* Task.send(`msg ${n++}`)
      }
      log("< end worker")
    }

    const work = Task.spawn(worker(3))
    assert.deepEqual(output, [])
    await Task.perform(Task.sleep(5))
    assert.deepEqual(work.state, { pending: {} })

    work.exit()
    await Task.perform(Task.sleep(20))
    assert.equal(output.includes("< end worker"), false)

    assert.deepEqual(work.state, { ok: undefined })
  })

  it.only("can spawn and then join", async () => {
    /**
     * @param {string} name
     * @param {number} duration
     * @param {number} count
     */
    function* worker(name, duration, count) {
      let n = 0
      while (n++ < count) {
        yield* Task.sleep(duration)
        yield* Task.send(`${name}#${n}`)
      }
    }

    function* main() {
      const a = Task.spawn(worker("a", 5, 6))
      yield* Task.sleep(8)
      const b = Task.spawn(worker("b", 7, 7))

      yield* a.join()
    }

    const result = await Task.perform(inspect(main()))
    const { mail } = result

    console.log([...mail].sort())

    assert.deepEqual(
      [...mail].sort(),
      ["a#2", "a#3", "a#4", "a#5", "a#6"],
      "has all but first message from a"
    )
  })
})
