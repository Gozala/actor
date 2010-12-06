'use stric'

var q = require('q')
,   Actor = require('actors').Actor
,   setTimeout = require('event-queue').setTimeout

function sleep(time) {
  var deferred = q.defer()
  setTimeout(deferred.resolve, time)
  return deferred.promise
}

exports.actor = Actor(function(time) {
  console.log('>>> Start task')
  yield sleep(time || 1000)
  console.log('<<< Finished task')
})

exports.example = function(time) {
  exports.actor.act(time)
}
