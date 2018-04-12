var express = require('express');
var bodyParser = require('body-parser');

var app = express();
app.use(bodyParser.json());

var server = app.listen(process.env.PORT || 8080, function() {
  var port = server.address().port;
  console.log('App now running on port', port);
});

// Generic error handler used by all endpoints.
function handleError(res, reason, message, code) {
  console.log('ERROR: ' + reason);
  res.status(code || 500).json({ error: message });
}

/*  "/api/player/:id"
 *   get player by id
 */
app.get('/api/player/:id', function(req, res) {
  res.status(200).json({ message: 'player route success' });
});

/*   "/api/player/:id"
 *    get matches by pipe seperated match id
 */
app.get('/api/matches/:matches', function(req, res) {
  res.status(200).json({ message: 'match route success' });
});
