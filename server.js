var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');

var app = express();
app.use(bodyParser.json());

var server = app.listen(process.env.PORT || 8080, function() {
  var port = server.address().port;
  console.log('App now running on port', port);
});

const apiURL = 'api.playbattlegrounds.com';
const apiKey =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJqdGkiOiIyYzI4Njg1MC0xOGNmLTAxMzYtZTdjMy0wMzMxODI1NzdmN2YiLCJpc3MiOiJnYW1lbG9ja2VyIiwiaWF0IjoxNTIyNjkyNjgyLCJwdWIiOiJibHVlaG9sZSIsInRpdGxlIjoicHViZyIsImFwcCI6InB1Ymctdmlld2VyIiwic2NvcGUiOiJjb21tdW5pdHkiLCJsaW1pdCI6MTB9.-W2PdClWJoDPNuSp1lA-45YPZkQLCGJbLiZOD5ouZ6s';
const headers = {
  Accept: 'application/vnd.api+json',
  Authorization: `Bearer ${apiKey}`
};

// Generic error handler used by all endpoints.
function handleError(res, reason, message, code) {
  console.log('ERROR: ' + reason);
  res.status(code || 500).json({ error: message });
}

/*  "/api/player/:id"
 *   get player by id
 */
app.get('/api/player/:id', function(req, res) {
  let shard = `${req.query.platform}-${req.query.region}`;
  let username = req.params.id;
  const apireq = https
    .get(
      {
        hostname: apiURL,
        path: `/shards/${shard}/players?filter[playerNames]=${username}`,
        headers
      },
      response => {
        response.on('data', d => {
          const player = JSON.parse(d);
          if (player.data && player.data.length > 0) {
            res.status(200).json({ player: player.data[0] });
          } else {
            res.status(404).json({ player: null, error: player });
          }
        });
      }
    )
    .on('error', e => {
      res.status(404).json({ player: null, error: JSON.parse(e) });
    });

  // res.status(200).json({ message: 'player route success' });
});

/*   "/api/player/:id"
 *    get matches by pipe seperated match id
 */
app.get('/api/matches/:matches', function(req, res) {
  res.status(200).json({ message: 'match route success' });
});
