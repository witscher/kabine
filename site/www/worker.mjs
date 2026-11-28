// www.kabine.dev: permanent redirect to kabine.dev, keeping path and query. Nothing is stored or logged.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "kabine.dev";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
