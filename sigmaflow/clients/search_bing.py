import os
import json
import httpx
import requests

def search(query, mkt='zh-CN', count=5):
    subscription_key = os.environ['BING_SEARCH_V7_SUBSCRIPTION_KEY']
    endpoint = os.environ['BING_SEARCH_V7_ENDPOINT']
    params = {'q': query, 'mkt': mkt, 'count': count}
    headers = {'Ocp-Apim-Subscription-Key': subscription_key}
    response = requests.get(endpoint, headers=headers, params=params)
    response.raise_for_status()
    res = response.json()
    data = []
    for r in res['webPages']['value']:
        d = {
            'title': r['name'],
            'url': r['url'],
            'snippet': r['snippet'],
            'date': r['dateLastCrawled'],
        }
        data.append(d)
    return data

async def async_search(query, mkt='zh-CN', count=5):
    subscription_key = os.environ['BING_SEARCH_V7_SUBSCRIPTION_KEY']
    endpoint = os.environ['BING_SEARCH_V7_ENDPOINT']
    params = {'q': query, 'mkt': mkt, 'count': count}
    headers = {'Ocp-Apim-Subscription-Key': subscription_key}

    async with httpx.AsyncClient(verify=False) as client:
        async with client.stream(
            "GET",
            endpoint,
            headers=headers,
            params=params,
            timeout=600,
        ) as stream:
            # error
            if stream.status_code != 200:
                raise HTTPException(status_code=500, detail=f'Bing API Error! url: {endpoint}, data: {params}')

            content = (await stream.aread()).decode("utf8")
            res = json.loads(content)
            data = []
            for r in res['webPages']['value']:
                d = {
                    'title': r['name'],
                    'url': r['url'],
                    'snippet': r['snippet'],
                    'date': r['dateLastCrawled'],
                }
                data.append(d)
            return data
