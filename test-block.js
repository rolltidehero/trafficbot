const { sameOrigin } = require('./dist/domain/entities/SessionContract');
console.log(sameOrigin('https://ppplayer.com/', 'https://ppplayer.com/'));
