import os


def sending_request(request, user_params):
    token = os.environ.get("STAGING_PROBE_TOKEN", "")
    if token:
        request.getRequestHeader().setHeader("X-HCN-Probe", token)
