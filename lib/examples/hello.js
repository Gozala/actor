'use strict'

var q = require('q')
,   Actor = require('actors').Actor
,   setTimeout = require('event-queue').setTimeout

function getNameAsinc(name, time) {
  var deferred = q.defer()
  setTimeout(deferred.resolve, time || 1000, name)
  return deferred.promise
}

exports.actor = Actor(function(name, time) {
  console.log('>>> Start task')
  console.log('Hello ' + (yield getNameAsinc(name, time)))
  console.log('<<< Finished task')
})

exports.example = function(name, time) {
  exports.actor(name, time)
}
