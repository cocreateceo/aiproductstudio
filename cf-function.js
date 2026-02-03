function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Handle /user.id=xxx -> /user.html with querystring
    if (uri.match(/^\/user\.id=(.+)$/)) {
        var id = uri.replace('/user.id=', '');
        request.uri = '/user.html';
        request.querystring = { id: { value: id } };
        return request;
    }

    // Handle /user -> /user.html (keep existing querystring)
    if (uri === '/user' || uri === '/user/') {
        request.uri = '/user.html';
        return request;
    }

    // Handle /admin -> /admin.html
    if (uri === '/admin' || uri === '/admin/') {
        request.uri = '/admin.html';
        return request;
    }

    // Handle other clean URLs without extension -> add .html
    if (!uri.includes('.') && uri !== '/') {
        request.uri = uri + '.html';
        return request;
    }

    return request;
}
