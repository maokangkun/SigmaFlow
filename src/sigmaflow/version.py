def get_new_pypi_version():
    import urllib.request
    from functools import reduce
    import xml.etree.ElementTree as ET

    pkg_url = "https://pypi.org/rss/project/SigmaFlow/releases.xml"
    with urllib.request.urlopen(pkg_url) as response:
        xml_content = response.read().decode("utf-8")
    root = ET.fromstring(xml_content)
    old_version = root[0].findall("item")[0].find("title").text
    num = reduce(lambda a, b: a * 100 + b, map(int, old_version.split(".")))
    num += 1
    arr = []
    while num:
        arr.append(num % 100)
        num //= 100
    arr += [0] * max(0, (3 - len(arr)))
    version = ".".join(map(str, arr[::-1]))

    return version


def get_pypi_readme():
    import re

    with open("README.md", "r") as f:
        long_description = f.read()
        m = re.findall(r"```mermaid.*?```", long_description, flags=re.DOTALL)
        long_description = long_description.replace(
            m[0],
            "![pipe demo](https://raw.githubusercontent.com/maokangkun/SigmaFlow/main/assets/demo_pipe.png)",
        ).replace(
            m[1],
            "![perf demo](https://raw.githubusercontent.com/maokangkun/SigmaFlow/main/assets/demo_perf.png)",
        )
        return long_description


__version__ = get_new_pypi_version()

# from setuptools import setup
# setup(
#     version=get_new_pypi_version(),
#     long_description=get_pypi_readme(),
#     long_description_content_type='text/markdown',
# )
