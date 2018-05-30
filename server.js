var express = require('express');
var https = require('https');
var bodyParser = require('body-parser');
var reqProm = require('request-promise');
require('dotenv').config();
const apiKey = process.env.apiKey;
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
const headers = {
  Accept: 'application/vnd.api+json',
  Authorization: `Bearer ${apiKey}`
};

var cacheManager = require('cache-manager');
var fsStore = require('cache-manager-fs');
// initialize caching on disk
const cacheReady = new Promise((resolve, reject) => {
  const cache = cacheManager.caching({
    store: fsStore,
    options: {
      ttl: 300,
      maxsize: 1000 * 1000 * 1000 /* max size in bytes on disk */,
      path: './cache',
      fillcallback: () => resolve(cache)
    }
  });
});

const options = {
  headers: {
    Accept: 'application/vnd.api+json',
    Authorization: `Bearer ${apiKey}`
  }
};

// Generic error handler used by all endpoints.
function handleError(res, reason, message, code) {
  console.log('ERROR: ' + reason);
  res.status(code || 500).json({ error: message });
}

app.get('/api/seasons', function(req, res) {
  const shard = `${req.query.platform}-${req.query.region}`;
  const seasonKey = `season-list`;
  cacheReady
    .then(seasonListCache => {
      return seasonListCache
        .wrap(
          seasonKey,
          () => {
            options.uri = `https://${apiURL}/shards/${shard}/seasons`;
            return reqProm(options)
              .then(response => {
                return JSON.parse(response);
              })
              .catch(e => {
                return JSON.parse(e);
              });
          },
          { ttl: 86400 }
        )
        .then(seasonList => {
          if (seasonList.data && seasonList.data.length > 0) {
            res.status(200).json({ seasons: seasonList.data });
          } else {
            return Promise.reject(seasonList);
          }
        })
        .catch(e => {
          res.status(404).json({ error: e });
        });
    })
    .catch(e => {
      res.status(404).json({ error: e });
    });
});

app.get('/api/player-details/:id', function(req, res) {
  const shard = `${req.query.platform}-${req.query.region}`;
  const id = req.params.id;
  const season = req.query.season;
  const isCurrent = req.query.current;
  const key = `player-details:${id}-${season}`;
  cacheReady
    .then(seasonListCache => {
      return seasonListCache
        .wrap(
          key,
          () => {
            options.uri = `https://${apiURL}/shards/${shard}/players/${id}/seasons/${season}`;
            return reqProm(options)
              .then(response => {
                return JSON.parse(response);
              })
              .catch(e => {
                return JSON.parse(e);
              });
          },
          { ttl: isCurrent ? 300 : 1000 * 1000 }
        )
        .then(seasonList => {
          if (seasonList.data && seasonList.data.attributes) {
            res
              .status(200)
              .json({ stats: seasonList.data.attributes.gameModeStats });
          } else {
            return Promise.reject(seasonList);
          }
        })
        .catch(e => {
          res.status(404).json({ error: e });
        });
    })
    .catch(e => {
      res.status(404).json({ error: e });
    });
});

/*  "/api/player/:id"
 *   get player by id
 */
app.get('/api/player/:id', function(req, res) {
  const shard = `${req.query.platform}-${req.query.region}`;
  const username = req.params.id;

  const key = `player:${shard}-${username}`;
  cacheReady.then(cache => {
    return cache
      .wrap(key, () => {
        options.uri = `https://${apiURL}/shards/${shard}/players?filter[playerNames]=${username}`;
        return reqProm(options)
          .then(response => {
            return JSON.parse(response);
          })
          .catch(e => {
            return JSON.parse(e);
          });
      })
      .then(rawPlayer => {
        if (rawPlayer.data && rawPlayer.data.length > 0) {
          const player = {
            name: rawPlayer.data[0].attributes.name,
            id: rawPlayer.data[0].id,
            region: req.query.region,
            platform: req.query.platform,
            matches: rawPlayer.data[0].relationships.matches.data
          };
          res.status(200).json({ player });
        } else {
          res.status(404).json({ error: rawPlayer });
        }
      })
      .catch(e => {
        res.status(404).json({ error: e });
      });
  });
});

/*   "/api/player/:id"
 *    get matches by pipe seperated match id
 */
app.get('/api/matches', function(req, res) {
  const matchIds = req.query.matches.split('|');
  const playerId = req.query.playerId;
  const shard = `${req.query.platform}-${req.query.region}`;
  const matchesToSearch = 3;
  const key = `matches:${req.query.matches}`;
  // const key = `matches:${req.query.matches}`;
  const rawMatches = [];
  let searchedMatches = 0;

  Promise.all(
    matchIds.map(matchId => {
      if (searchedMatches <= matchesToSearch) {
        const key = `match:${matchId}`;
        return cacheReady.then(cache => {
          return cache
            .wrap(
              key,
              () => {
                searchedMatches++;
                options.uri = `https://${apiURL}/shards/${shard}/matches/${matchId}`;
                return reqProm(options)
                  .then(response => {
                    return JSON.parse(response);
                  })
                  .catch(e => {
                    return null;
                  });
              },
              { ttl: 1000 * 1000 }
            )
            .then(match => {
              if (match) {
                rawMatches.push(match);
              }
            });
        });
      }
    })
  )
    .then(results => {
      if (rawMatches.length > 1) {
        res.status(200).json({ matches: formatMatches(rawMatches, playerId) });
      } else {
        res.status(404).json({ error: 'no matches' });
      }
    })
    .catch(error => {
      res.status(404).json({ error: error });
    });
});

/**
 * Get match telemetry data
 * id: telemetry url
 */
app.get('/api/telemetry', function(req, res) {
  const telemUri = req.query.uri;
  const teammateIds = req.query.teammates.split('|');
  let enemyIds = req.query.enemies;
  if (enemyIds !== 'null' && enemyIds !== '') {
    enemyIds = enemyIds.split('|');
  } else {
    enemyIds = null;
  }

  options.uri = telemUri;
  reqProm(options)
    .then(response => {
      const telemetry = JSON.parse(response);

      const teamAttacks = {};
      const teamKills = {};
      const teamMovements = {};
      const teamDamageMap = {};

      const enemyAttacks = {};
      const enemyKills = {};
      const enemyMovements = {};
      const enemyDamageMap = {};

      teammateIds.forEach(player => {
        const jumpTime = telemetry.find(element => {
          return (
            element._T === 'LogVehicleLeave' &&
            element.vehicle.vehicleId === 'DummyTransportAircraft_C' &&
            element.character.name === player
          );
        })._D;

        teamMovements[player] = telemetry.filter(element => {
          return (
            element._T === 'LogPlayerPosition' &&
            element.character.name === player &&
            element._D >= jumpTime
          );
        });

        const playerAttacks = telemetry.filter(element => {
          return (
            element._T === 'LogPlayerTakeDamage' &&
            element.attacker.name === player
          );
        });

        teamKills[player] = telemetry.filter(element => {
          return (
            element._T === 'LogPlayerKill' && element.killer.name === player
          );
        });

        const aggregatedAttacks = {};
        const damageMap = {};
        playerAttacks.forEach(attack => {
          if (!aggregatedAttacks[attack.damageReason]) {
            const sameBodyPart = playerAttacks.filter(bodyPart => {
              return attack.damageReason === bodyPart.damageReason;
            });
            let damage = 0;
            damageMap[attack.damageReason] = {
              amount: sameBodyPart.reduce((accumulator, attack) => {
                return accumulator + attack.damage;
              }, damage),
              bodyPart: attack.damageReason
            };
          }

          if (!aggregatedAttacks[attack.damageCauserName]) {
            const sameWeapon = playerAttacks.filter(weapon => {
              return attack.damageCauserName === weapon.damageCauserName;
            });
            sameWeapon.forEach((weap, index) => {
              const x = telemetry.find(element => {
                return element.attackId === weap.attackId;
              });
              sameWeapon[index].attacker = x.attacker;
            });
            aggregatedAttacks[attack.damageCauserName] = sameWeapon;
          }
        });

        teamAttacks[player] = Object.entries(aggregatedAttacks).reduce(
          (arr, [key, value]) => [...arr, value],
          []
        );

        let ordering = {},
          sortOrder = [
            'HeadShot',
            'TorsoShot',
            'ArmShot',
            'PelvisShot',
            'LegShot',
            'NonSpecific'
          ];
        for (var i = 0; i < sortOrder.length; i++) ordering[sortOrder[i]] = i;

        teamDamageMap[player] = Object.entries(damageMap)
          .reduce((arr, [key, value]) => [...arr, value], [])
          .sort(function(a, b) {
            return (
              ordering[a.bodyPart] - ordering[b.bodyPart] ||
              a.name.localeCompare(b.bodyPart)
            );
          });
      });

      if (enemyIds) {
        enemyIds.forEach(player => {
          const jumpTime = telemetry.find(element => {
            return (
              element._T === 'LogVehicleLeave' &&
              element.vehicle.vehicleId === 'DummyTransportAircraft_C' &&
              element.character.name === player
            );
          })._D;

          enemyMovements[player] = telemetry.filter(element => {
            return (
              element._T === 'LogPlayerPosition' &&
              element.character.name === player &&
              element._D >= jumpTime
            );
          });

          const enemyAttacks = telemetry.filter(element => {
            return (
              element._T === 'LogPlayerTakeDamage' &&
              element.attacker.name === player
            );
          });

          enemyKills[player] = telemetry.filter(element => {
            return (
              element._T === 'LogPlayerKill' && element.killer.name === player
            );
          });

          const aggregatedAttacks = {};
          const damageMap = {};
          enemyAttacks.forEach(attack => {
            if (!aggregatedAttacks[attack.damageReason]) {
              const sameBodyPart = enemyAttacks.filter(bodyPart => {
                return attack.damageReason === bodyPart.damageReason;
              });
              let damage = 0;
              damageMap[attack.damageReason] = {
                amount: sameBodyPart.reduce((accumulator, attack) => {
                  return accumulator + attack.damage;
                }, damage),
                bodyPart: attack.damageReason
              };
            }

            if (!aggregatedAttacks[attack.damageCauserName]) {
              const sameWeapon = enemyAttacks.filter(weapon => {
                return attack.damageCauserName === weapon.damageCauserName;
              });
              sameWeapon.forEach((weap, index) => {
                const x = telemetry.find(element => {
                  return element.attackId === weap.attackId;
                });
                sameWeapon[index].attacker = x.attacker;
              });
              aggregatedAttacks[attack.damageCauserName] = sameWeapon;
            }
          });

          enemyAttacks[player] = Object.entries(aggregatedAttacks).reduce(
            (arr, [key, value]) => [...arr, value],
            []
          );

          let ordering = {},
            sortOrder = [
              'HeadShot',
              'TorsoShot',
              'ArmShot',
              'PelvisShot',
              'LegShot',
              'NonSpecific'
            ];
          for (var i = 0; i < sortOrder.length; i++) ordering[sortOrder[i]] = i;

          enemyDamageMap[player] = Object.entries(damageMap)
            .reduce((arr, [key, value]) => [...arr, value], [])
            .sort(function(a, b) {
              return (
                ordering[a.bodyPart] - ordering[b.bodyPart] ||
                a.name.localeCompare(b.bodyPart)
              );
            });
        });
      }
      res.status(200).json({
        teamAttacks,
        teamKills,
        teamMovements,
        teamDamageMap,
        enemyAttacks,
        enemyKills,
        enemyMovements,
        enemyDamageMap
      });
    })
    .catch(e => {
      res.status(200).json({ error: e });
    });
});

function formatMatches(rawMatches, playerId) {
  const matches = [];
  try {
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
          won: playerRoster.attributes.won === 'true',
          rank: playerRoster.attributes.stats.rank,
          teamId: playerRoster.attributes.stats.teamId
        },
        teammates: teammates.sort(function(a, b) {
          return a.id === playerParticipant.id
            ? -1
            : b.id == playerParticipant.id
              ? 1
              : 0;
        })
      };

      let enemies = {};
      if (!team.stats.won) {
        const enemyRoster = rosterList.find(
          roster => roster.attributes.stats.rank === 1
        );

        if (enemyRoster) {
          const enemyTeammates = [];
          enemyRoster.relationships.participants.data.forEach(participant => {
            const id = participant.id;
            let teammateParticipant = participantList.find(teammate => {
              return teammate.id === id;
            });

            enemyTeammates.push({
              stats: teammateParticipant.attributes.stats,
              id: teammateParticipant.id
            });
          });

          enemies = {
            stats: {
              won: enemyRoster.attributes.won === 'true',
              rank: enemyRoster.attributes.stats.rank,
              teamId: enemyRoster.attributes.stats.teamId
            },
            teammates: enemyTeammates
          };
        }
      }

      const telemUrl = rawMatch.included.find(element => {
        return element.type === 'asset';
      }).attributes.URL;

      let duration = new Date(null);
      duration.setSeconds(rawMatch.data.attributes.duration);
      matches.push({
        gameMode: rawMatch.data.attributes.gameMode,
        duration: duration,
        date: new Date(rawMatch.data.attributes.createdAt),
        map: rawMatch.data.attributes.mapName,
        player: playerParticipant,
        team: team,
        enemies,
        telemUrl
      });
    });
    return matches.sort((a, b) => b.date - a.date);
  } catch (error) {
    return matches.sort((a, b) => b.date - a.date);
  }
}
