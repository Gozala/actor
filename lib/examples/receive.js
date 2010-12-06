'use strict'

var Actor = require('actors').Actor
,   setTimeout = require('event-queue').setTimeout

exports.actor = Actor(function actor() {
  var message = actor.receive()
    , name = actor.receive()

  console.log('< Waiting for messages')
  console.log('< ' + (yield message) + ' ' + (yield name))
})

exports.example = function() {
  var actor = exports.actor
  console.log('> Executing an actor')
  actor.act()
  setTimeout(function act() {
    actor.post('Hello')
    actor.post('Actor')
  }, 300)
  console.log('> We will send messages to actor in 300ms.')
}
