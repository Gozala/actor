# actor #

Experimental library implementing [Scala] like [Actors] in javascript. Library
uses [generators] introduced in [JavaScript 1.7] to provide [continuation]
passing mechanism with a linear control flow but asynchronous nature. Idea is
to use implement actors in following fashion:

    var actor = Actor(function act() {
      // yield saves continuation untill returned promise is resolved
      var data = yield getDataAsync()
      doSomething(data)
    })

Actor will use `yield` to save [continuation] until [promise] returned by
`getDataAsync` asynchronous function is fulfilled. After generator will be
resumed with a fulfill value, so that it gets assigned to data variable.
As a result program is executed sequentially without blocking event-loop.

This library has been tested on Firefox using [teleport] and on [Jetpack]. It's
very likely that this library will work / won't be to hard to make it work on
[rhino] based platforms like [RingoJS].

## Examples ##

- [continuation passing after delay](https://github.com/Gozala/actor/blob/master/lib/examples/sleep.js)
- [continuation passing aftor async operation](https://github.com/Gozala/actor/blob/master/lib/examples/hello.js)
- [message passing](https://github.com/Gozala/actor/blob/master/lib/examples/receive.js)

## Install ##

    npm install actor

## Play ##

    teleport activate
    open http://localhost:4747/packages/actor/

## Prior Art / Source of inspiration ##

- [SamePlace - Asynchrospaghetti for friends](http://hyperstruct.net/2008/05/27/synchronous-invocation-in-javascript-part-1-problem-and-basic-solution/)
- [A Sequential, Actor-like API for Server-side JavaScript](http://blog.ometer.com/2010/11/28/a-sequential-actor-like-api-for-server-side-javascript/)
- [Communicating Event-Loop Concurrency and Distribution](http://wiki.ecmascript.org/doku.php?id=strawman:concurrency)
- [defer: Taming asynchronous javascript with CoffeeScript](http://gfxmonk.net/2010/07/04/defer-taming-asynchronous-javascript-with-coffeescript.html)
- [Single frame continuations proposal](https://mail.mozilla.org/pipermail/es-discuss/2010-March/010865.html)

[continuation]:http://en.wikipedia.org/wiki/Continuation
[event-loop]:http://en.wikipedia.org/wiki/Event_loop
[promise]:http://wiki.commonjs.org/wiki/Promises/B
[Scala]:http://www.scala-lang.org/
[RingoJS]:http://ringojs.org/
[rhino]:http://www.mozilla.org/rhino/
[Jetpack]:https://jetpack.mozillalabs.com/
[teleport]:http://jeditoolkit.com/teleport/#guide
[JavaScript 1.7]:https://developer.mozilla.org/en/JavaScript/New_in_JavaScript/1.7
[Generatiors]:https://developer.mozilla.org/en/JavaScript/Guide/Iterators_and_Generators
[Actors]:http://en.wikipedia.org/wiki/Actor_model
