var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');
var reqProm = require('request-promise');

var allowCrossDomain = function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Content-Length, X-Requested-With'
  );

  // intercept OPTIONS method
  if ('OPTIONS' == req.method) {
    res.send(200);
  } else {
    next();
  }
};

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.json({ type: 'application/vnd.api+json' }));
app.use(allowCrossDomain);

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
  const shard = `${req.query.platform}-${req.query.region}`;
  const username = req.params.id;
  const apireq = https
    .get(
      {
        hostname: apiURL,
        path: `/shards/${shard}/players?filter[playerNames]=${username}`,
        headers
      },
      response => {
        if (response.statusCode === 429) {
          res.status(404).json({ player: null, error: 'Too many requests' });
        } else {
          response.on('data', d => {
            const rawPlayer = JSON.parse(d);
            if (rawPlayer.data && rawPlayer.data.length > 0) {
              const player = {
                name: rawPlayer.data[0].attributes.name,
                id: rawPlayer.data[0].id,
                matches: rawPlayer.data[0].relationships.matches.data
              };
              res.status(200).json({ player });
            } else {
              res.status(404).json({ player: null, error: rawPlayer });
            }
          });
        }
      }
    )
    .on('error', e => {
      res.status(404).json({ player: null, error: JSON.parse(e) });
    });

  // res.status(200).json({ message: 'player route success' });
});

//I'm using cache-manager with cache-manager-fs for my caching by the way, in case you want to add caching as well

/*   "/api/player/:id"
 *    get matches by pipe seperated match id
 */
app.get('/api/matches', function(req, res) {
  const matchIds = req.query.matches.split('|');
  const playerId = req.query.playerId;
  const shard = `${req.query.platform}-${req.query.region}`;
  const rawMatches = [];
  const matchesToSearch = 3;
  var options = {
    headers: {
      Accept: 'application/vnd.api+json',
      Authorization: `Bearer ${apiKey}`
    }
  };

  Promise.all(
    matchIds.map((matchId, index) => {
      if (index <= matchesToSearch) {
        options.uri = `https://${apiURL}/shards/${shard}/matches/${matchId}`;
        return reqProm(options)
          .then(response => {
            rawMatches.push(JSON.parse(response));
          })
          .catch(e => {
            res.status(404).json({ player: null, error: JSON.parse(e) });
          });
      }
    })
  )
    .then(results => {
      const matches = [];
      rawMatches.forEach(rawMatch => {
        // get list of all participants
        const participantList = rawMatch.included.filter(element => {
          return element.type === 'participant';
        });

        // get list of all rosters
        const rosterList = rawMatch.included.filter(element => {
          return element.type === 'roster';
        });

        // get participant object of current user
        let playerParticipant = participantList.find(participant => {
          return participant.attributes.stats.playerId === playerId;
        });

        if (!playerParticipant) return;

        // format current player object
        playerParticipant = {
          stats: playerParticipant.attributes.stats,
          id: playerParticipant.id
        };

        // find roster that player belongs to
        const playerRoster = rosterList.find(roster => {
          let found = false;
          roster.relationships.participants.data.forEach(participant => {
            if (participant.id === playerParticipant.id) found = true;
          });
          return found;
        });

        // find and format participant objects of player's teammates
        const teammates = [];
        playerRoster.relationships.participants.data.forEach(participant => {
          const id = participant.id;
          let teammateParticipant = participantList.find(teammate => {
            return teammate.id === id;
          });

          teammates.push({
            stats: teammateParticipant.attributes.stats,
            id: teammateParticipant.id
          });
        });

        const team = {
          stats: {
            won: playerRoster.attributes.won == 'true',
            rank: playerRoster.attributes.stats.rank,
            teamId: playerRoster.attributes.stats.teamId
          },
          teammates: teammates.sort(function(a, b) {
            return a.id === playerParticipant.id
              ? -1
              : b.id == playerParticipant.id ? 1 : 0;
          })
        };

        let duration = new Date(null);
        duration.setSeconds(rawMatch.data.attributes.duration);
        matches.push({
          gameMode: rawMatch.data.attributes.gameMode,
          duration: duration,
          date: new Date(rawMatch.data.attributes.createdAt),
          map: rawMatch.data.attributes.mapName,
          player: playerParticipant,
          team: team
        });
      });
      res
        .status(200)
        .json({ matches: matches.sort((a, b) => b.date - a.date) });
    })
    .catch(error => {
      res.status(404).json({ error: error });
    });
});
