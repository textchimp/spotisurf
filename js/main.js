// let SPOTIFY_AUTH_BEARER =  '';//'Bearer ';

const SPOTIFY_BASE_URL = 'https://api.spotify.com/v1/';
const SPOTISURF_CLOUD_FUNCTION_TOKEN_URL = 'https://us-central1-functions-test-24b29.cloudfunctions.net/spotisurf';

// TODO: /v1/artists  -- get several artists at once (load recommended auto?)

let nowPlaying = null;   // which track is playing right now?
let lastPlaying = null;  // what was the previous playing track? (spacebar)
const breadcrumbTrail = [];  // keep a history of visited artist details

$(document).ready(function(){

  $('#searchText').focus();

  // test mode: auto-load search results: use via URL: ?test=ARTISTNAME
  const testSearch = new URLSearchParams(window.location.search).get('test');
  if( testSearch ) {
    $('#searchText').val( testSearch );
    api.getSearchResults( testSearch );
  }


  // form submit: do artist name search
  $('#search').submit( ev => {
    ev.preventDefault(); // no reload
    $('#details').slideUp(); // if already viewing artist details
    api.getSearchResults( $('#searchText').val() );
  }); // on form submit


  // On result click: go to artist details
  $(document).on('click', '.result', function(){

    api.getArtistTopTracks(
      $(this).attr('artistID'),
      $(this).attr('artistName'),
      $(this).attr('artistImage'),
      $(this).data('genres') // sneaky jQuery array-as-attribute
    );

  }); // result click


  // On track click: play/pause toggle
  $(document).on('click', '.player', function(ev){

    const audio = $(this).find('audio')[0]; // we want the vanilla DOM node
    if( !audio ) {
      return; // no preview track available
    }

    audio.onended = ui.onAudioEnded; // attach track-end callback
    ui.playPause( this, audio );

  }); // result click


  // On click of recommendation 'view' text: load artist details
  $(document).on('click', '.goto', function(ev){
    ev.stopPropagation(); // prevent play/pause trigger on parent <li>

    const id = $(this).closest('li').attr('artist-id'); // get artist ID from parent <li>
    api.loadArtistFromRecommendations( id );
  }); // on 'view' rec click


  // handle keypresses to control music playback
  $(document).on('keydown', function(ev){

    if( ev.target.id === 'searchText' ){
      return; // ignore typing into search field
    }


    let preventDefault = true;

    switch( ev.key ){
    case ' ':
      // Spacebar toggles current audio playback, or starts current artist track

      if( nowPlaying === null && lastPlaying === null ){
        ui.playByIndex( 0 ); // start playing the first of the artist tracks
      } else {
        ui.playPauseCurrent();
      }
      break;

    case 'Enter':
      // Enter opens the currently playing track as a new Spotify tab

      if( nowPlaying === null ){
        return; // ignore when nothing is playing
      }

      if( nowPlaying.index >= 100 ){
        // recommended track (they all have 100 added to index):
        window.open( $(nowPlaying.elem).attr('artist-url') );
      } else {
        // current artist:
        window.open( $(nowPlaying.elem).attr('track-url') );
        ui.playPauseCurrent();  // stop playing because Spotify track page autoplays 🙄
      }
      break;

    case 'ArrowLeft':
      // Left arrow plays previous track (unless at start)
      nowPlaying && ui.playByIndex( parseInt(nowPlaying.index) - 1, true );
      break;

    case 'ArrowRight':
      // Right arrow plays next track (unless at end)
      nowPlaying && ui.playByIndex( parseInt(nowPlaying.index) + 1 );
      break;

    default:
      preventDefault = false; // stop preventDefault() from running, below
    } // switch

    // If we don't preventDefault() for unused keys,
    // shorts for reload, open dev tools etc stop working!
    preventDefault && ev.preventDefault();

  }); // on keypress


  // click on breadcrumb trail item: view artist details again
  $(document).on('click', '#trail a', function(){
    // re-use loadArtistFromRecommendations for this click
    api.loadArtistFromRecommendations( $(this).attr('artist-id') );
  }); // breadcrumb trail item click

}); // document ready


// API: all the code for making AJAX requests to Spotify API is here;
// error handler code to request new token from Rails backend also here
//
// Most of these methods use display methods in the 'ui' object to show results
const api = {

  SPOTIFY_AUTH_BEARER: '', // API token - initialised by fetchInitialToken()


  fetchInitialToken(){
    $.getJSON( SPOTISURF_CLOUD_FUNCTION_TOKEN_URL )
    .done( data => {
      console.log('initial token:', data);
      this.SPOTIFY_AUTH_BEARER = 'Bearer ' + data.token;
      $('#searchText').attr('placeholder', 'search artist');
    })
    .fail( err => {
      $('#searchText').attr('placeholder', 'token error! sorry');
      console.warn('initial token load fail', err)
    });
  }, // fetchInitialToken

  getSearchResults( text ){
    console.log('getSearchResults():', text);

    $.ajax({
      url: SPOTIFY_BASE_URL + 'search',
      dataType: 'json',
      data: {
        q: text,
        type: 'artist'
      },
      beforeSend: xhr => xhr.setRequestHeader('Authorization', this.SPOTIFY_AUTH_BEARER)
    })
    .done( ui.showSearchResults )
    .fail( err => this.handleRequestError(err, {request: 'getSearchResults', args: [text] }) );
  }, // getSearchResults


  loadArtistFromRecommendations( id ){
    console.log('loadArtistFromRecommendations()', id);

    // Hide current details, show loading message
    $('#details > .heading, #details > .grid').hide();
    $('#details').css('background-image', 'none');
    $('#details .loading').show();

    nowPlaying = lastPlaying = null; // reset play (for spacebar)

    // Because this artist has been selected from a recommendation
    // (or from a breadcrumb trail click),
    // we don't have the artist image as we do from a search result;
    // so first we have to get the artist details, and then we can
    // load the Top Tracks and Recommendations, as usual
    $.ajax({
      url: SPOTIFY_BASE_URL + `artists/${id}`,
      dataType: 'json',
      beforeSend: xhr => xhr.setRequestHeader('Authorization', this.SPOTIFY_AUTH_BEARER)
    })
    .done( data => {
      // console.log('data', data);
      const image = data.images.length ? data.images[0].url : null;
      api.getArtistTopTracks( data.id, data.name, image, data.genres );
    })
    .fail( err => this.handleRequestError(err, {request: 'loadArtistFromRecommendations', args: [id] }) );

  }, // loadArtistFromRecommendations


  getArtistTopTracks( id, name, image, genres=[] ){
    console.log('getArtistTopTracks()', {id, name, image, genres});

    $.ajax({
      url: SPOTIFY_BASE_URL + `artists/${id}/top-tracks`,
      dataType: 'json',
      data: { country: 'AU' }, // top tracks are always region-based!
      beforeSend: xhr => xhr.setRequestHeader('Authorization', this.SPOTIFY_AUTH_BEARER)
    })
    .done( data => ui.showArtistDetails(data, id, name, image, genres) )
    .fail( err => this.handleRequestError(err, {request: 'getArtistTopTracks', args: [id, name, image, genres] }) );

    this.getArtistRecs( id ); // also get the recommendations to show in the details panel
  }, //getArtistTopTracks


  getArtistRecs( id ){
    console.log('getArtistRecs():', id);

    $.ajax({
      url: SPOTIFY_BASE_URL + 'recommendations',
      dataType: 'json',
      data: { seed_artists: id },
      // TODO: you can provide up to 5 seed IDs! Also other params
      // like 'danceability', 'loudness' etc - allow user to fine tune these
      // via UI? https://developer.spotify.com/console/get-recommendations/
      beforeSend: xhr => xhr.setRequestHeader('Authorization', this.SPOTIFY_AUTH_BEARER)
    })
    .done( data => ui.showRecsInArtistDetails(data) )
    .fail( err => this.handleRequestError(err, {request: 'getArtistRecs', args: [id] }) );

  }, //getArtistRecs


  getArtistRelated( id ){
    console.log('getArtistRecs():', id);

    $.ajax({
      url: SPOTIFY_BASE_URL + `artists/${id}/related-artists`,
      dataType: 'json',
      beforeSend: xhr => xhr.setRequestHeader('Authorization', this.SPOTIFY_AUTH_BEARER)
    })
    .done( data => ui.showRelatedArtistsInArtistDetails(data) )
    .fail( err => this.handleRequestError(err, {request: 'getArtistRelated', args: [id] }) );

  }, // getArtistRelated


  handleRequestError( err, req ){

    if( err.status === 401 ){
      console.log('%cGenerating new token...', 'color: orange; font-weight: bold');
      api.generateNewTokenAndRetry(req); // see comments in this method below
    } else {
      console.warn('API ERROR', req.request, err.status, err.statusText);
      console.warn( err );
    }

  }, // handleRequestError


  generateNewTokenAndRetry( lastRequest ){

    // Spotify API tokens expire after an hour, so if a request fails, it's
    // probably because the token has expired.
    // When this happens, we make a request to the Cloud Function endpoint, which
    // makes a request to the Spotify accounts API endpoint using the API secret to
    // create a new access token, which is stored in the database, and sent as the
    // response to this getJSON request. We set the new token into our JS
    // var and re-try the last API request.
    // We need a Cloud Function for regenerating the token, because it involves API
    // secret keys which are not intended to be exposed to the frontend.

    $('#status').html('Updating API token, please wait...').show();

    // $.getJSON('/token/regenerate/nouser')
    $.getJSON( SPOTISURF_CLOUD_FUNCTION_TOKEN_URL )
    .done( data => {
      console.log('new token:', data);
      this.SPOTIFY_AUTH_BEARER = 'Bearer ' + data.token;

      // re-attempt last API call with new token, to avoid user confusion or page reload:
      console.log('Re-run API call:', lastRequest);
      api[ lastRequest.request ]( ...lastRequest.args );  // Google: "spread" params

      $('#status').hide().empty();
    })
    .fail( console.warn );

  }, // generateNewTokenAndRetry

};


api.fetchInitialToken(); // get current token from Cloud Function endpoint ASAP



// UI object: this contains all the display methods which are called from
// the 'done()' handlers of the AJAX requests in the API methods above.
// It has also ended containing a lot of the audio controls, which
// should probably be moved to their own audio-specific object.
// TODO: Move audio controls to new audio object
const ui = {

  showSearchResults( data ){
    console.log('showResults():', data);

    $('#query').html( $('#searchText').val() );
    $('#results').show();

    const $list = $('#resultsList').empty();  // clear list

    data.artists.items.forEach( a => {

      let imgURL = '';
      if('images' in a && a.images.length){
        imgURL = a.images[0].url;  // length-1 for smallest?
      }

      const $artist = $(`
        <li artistID="${a.id}" artistName="${a.name}" artistImage="${imgURL}" class="result">
            <div class="name">
              <strong>${ a.name }</strong>
            </div>
        </li>
      `)
      .css('background-image', `url(${ imgURL })`)
      .data('genres', a.genres);  // attach genres array via jquery for artist details

      $list.append( $artist );
    }); // artists forEach

  }, // showResults


  showArtistDetails( artist, id, name, imgURL, genres ){
    console.log('showArtistDetails()', artist, name, imgURL);

    this.updateBreadcrumbTrail({ name: name, id: id });

    if( genres.length ){
      const genreOutput = genres.slice(0,6).join(', '); // just first 6 genres
      $('#details .genres').html( genreOutput );
    }


    // Clicking the artist name takes you to the Spotify page
    $('#artistName')
      .html(name)
      .attr({
        href: artist.tracks[0].artists[0].external_urls.spotify,
        title: `View ${name} on Spotify`
      });

    $('#details > .heading, #details > .grid').show();
    $('#details .loading').hide();

    const $tracks = $('#details .topTracks > ol').empty();

    artist.tracks.forEach( (t, i) => {
      $tracks.append(`
        <li
          class="player ${t.preview_url ? 'hasPreview' : 'noPreview'}"
          player-index="${i}"
          track-url="${ t.external_urls.spotify }"
        >
          ${ this.getAudioTag( t, i ) }
          <em>${t.name}</em>
        </li>
      `);
    }); // for each track

    $('#details')
      .css('background-image', `url(${ imgURL })`)
      .slideDown();

  }, // showDetails


  showRecsInArtistDetails( data ){
    console.log('showRecsInArtistDetails():', data);

    const $recsList = $('#details .recs ul').empty();

    data.tracks.forEach( (t, i) => {

      // add 100 for recommendations, to keep indexes unique (from artist tracks)
      const index = i + 100;

      $recsList.append(`
        <li
          class="rec player ${t.preview_url ? 'hasPreview' : 'noPreview'}"
          player-index="${index}"
          artist-id="${  t.artists[0].id }"
          artist-url="${ t.artists[0].external_urls.spotify }"
        >
          ${ this.getAudioTag( t, index) }
          &nbsp; ${ t.artists[0].name }
          <span class="track-name">– ${ t.name }</span>
          <span class="goto">view</span>
        </li>
      `);
    });

  }, //showRecsInArtistDetails,


  playPause( target, audio ){
    console.log('==== playPause():', {target, audio} );

    if( nowPlaying && nowPlaying.audio === audio ){
      // clicked on currently-playing track: pause it (and hide track name)
      this.audioFadeOut( audio );
      $(target).removeClass('playing'); // li tag
      nowPlaying = null;
      return; // avoid the play code at the end of this function
    } else if( nowPlaying !== null ){
      // stop other currently playing track first (and hide track name)
      this.audioFadeOut( nowPlaying.audio );
      $(nowPlaying.elem).removeClass('playing');
    }

    this.audioFadeIn( audio );
    $(target).addClass('playing');

    nowPlaying = { index: $(target).attr('player-index'), audio: audio, elem: target };
  }, // playPause


  playPauseCurrent(){
    if( nowPlaying !== null ){
      // pause current track
      this.audioFadeOut(nowPlaying.audio);
      $(nowPlaying.elem).removeClass('playing');
      lastPlaying = { ...nowPlaying };
      nowPlaying = null;
    } else {
      // unpause track that was playing most recently
      if( lastPlaying !== null ){
        nowPlaying = { ...lastPlaying };
        this.audioFadeIn( nowPlaying.audio );
        $(nowPlaying.elem).addClass('playing');
      }
    }
  }, // playPauseCurrent


  playByIndex( index, previous=false ){
    console.log('playByIndex(): ', index);

    const audio = $(`audio[index="${index}"]`)[0];
    if( audio ){

      // attach track-end callback, in case not added by click handler
      audio.onended = ui.onAudioEnded;

      if( nowPlaying !== null ){
        // nowPlaying.audio.pause();
        this.audioFadeOut( nowPlaying.audio );
        $(nowPlaying.elem).removeClass('playing');
      }

      // audio.play();
      this.audioFadeIn( audio );

      const $parentLi = $(audio).closest('li').eq(0);
      $parentLi.addClass('playing');
      nowPlaying = { index: index, audio: audio, elem: $parentLi };

    } else {
      // No audio element at this index!
      // But still check if we should skip a missing preview

      if( previous ){
        // we're going backwards (left-arrow press), so try to skip
        // over missing preview tracks in reverse direction
        if( index%100 > 0 ){
          // TODO: off-by-1 bug here causes first recommended track to jump
          // back to last artist tracks; but i don't actually mind this!
          this.playByIndex( index - 1, true ); // 2nd arg is 'previous' arg!
        }
      } else if( (index%100) < $(`li[player-index="${index}"]`).siblings().length ) {
        // if next index does not contain audio but we're not at the end of the list,
        // skip what might be a track without a preview!
        // Note that for the end-of-list test we have to ignore the 100 we might
        // have added to the index to make sure the recommendations tracks have
        // distinct indexes, relative to the current artist's tracks
        this.playByIndex( index + 1 );
      }

    } // else no audio elem

  }, // playByIndex


  onAudioEnded( ev ){
    console.log('ui.onAudioEnded()', ev);

    // When a track ends naturally, still need to reset the controls
    const index = $(ev.target).attr('index');
    $(`li[player-index="${index}"]`).removeClass('playing');

    lastPlaying = { ...nowPlaying };
    nowPlaying = null;

    ui.playByIndex( parseInt(index) + 1 ); // try to advance to the next track
  }, //onAudioEnded


  audioFadeOut( audio ){
    // Pasted from https://stackoverflow.com/a/36900986
    if(audio.volume){
      let vol = audio.volume;
      const speed = 0.08;  // Rate of decrease
      const fAudio = setInterval(function(){
        vol -= speed;
        audio.volume = vol.toFixed(1);
        if( vol.toFixed(1) <= 0 ){
           clearInterval(fAudio);
           audio.pause();
           audio.volume = 1.0; // just in case?
        }
      }, 50);
    }
  }, //audioFadeOut


  audioFadeIn( audio ){
    // Pasted from https://stackoverflow.com/a/36900986
    audio.play();
    let vol = 0;
    audio.volume = vol;
    const speed = 0.08;  // Rate of increase
    const fAudio = setInterval(function(){
      vol += speed;
      audio.volume = vol.toFixed(1);
      if( vol.toFixed(1) >= 1.0 ){
         clearInterval(fAudio);
      }
    }, 50);
  }, //audioFadeOut


  getAudioTag( track, index, isRec=false ){
    // used by artist track list and artist recommendation list

    return track.preview_url ?
      `<audio index="${ index }">
         <source src="${ track.preview_url }"  type="audio/mpeg">
       </audio>
       <span class="controls" id="controls${ index }"></span>`
    :
      `<span class="nocontrols">&#9654;</span>`
    ;
  }, // getAudioTag


  updateBreadcrumbTrail( latest ){
    console.log('updateBreadcrumbTrail()', {latest});

    const $trailList = $('#trail > ul.trail').empty();
    breadcrumbTrail.forEach( (artist, i) => {
      $trailList.append(`
        <li>
          <a artist-id="${artist.id}">${ artist.name }</a>
          ${
            // add separator for all but last item
            i < breadcrumbTrail.length-1 ? '<span>&gt;</span>' : ''
           }
        </li>
      `);
    }); // each artist

    // push at end, i.e. don't show current artist on trail
    breadcrumbTrail.push( latest );

    if( breadcrumbTrail.length > 1 ){
      $('#trail').show();
    }
  }, // updateBreadcrumbTrail

}; // ui
