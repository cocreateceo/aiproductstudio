function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Handle clean URL: /user.id=xxx -> /user.html?id=xxx
    if (uri.match(/^\/user\.id=(.+)$/)) {
        var id = uri.replace('/user.id=', '');
        request.uri = '/user.html';
        request.querystring = { id: { value: id } };
    }

    return request;
}
