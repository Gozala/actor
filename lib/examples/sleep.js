/* vim:set ts=2 sw=2 sts=2 et autoread */
'use strict';var Actor, Deferred, When, setTimeout, sleep, _ref;
_ref = require('q'), When = _ref.when, Deferred = _ref.defer;
Actor = require('actor').Actor;
setTimeout = require('event-queue').setTimeout;
sleep = function(time) {
  var promise, resolve, _ref;
  _ref = new Deferred, resolve = _ref.resolve, promise = _ref.promise;
  setTimeout(resolve, time);
  return promise;
};
exports.actor = new Actor(function(time) {
  if (time == null) {
    time = 1000;
  }
  console.log('>>> Task started');
  yield(sleep(time));
  console.log('<<< Task finished');
});
exports.example = function(time) {
  return exports.actor.start(time);
};