import setuptools
import requests
from functools import reduce
import xml.etree.ElementTree as ET
import re

pkg_name = 'SigmaFlow'

def get_new_version():
    pkg_url = f'https://pypi.org/rss/project/{pkg_name}/releases.xml'
    root = ET.fromstring(requests.get(pkg_url).text)
    old_version = root[0].findall('item')[0].find('title').text
    num = reduce(lambda a,b:a*100+b, map(int, old_version.split('.')))
    num += 1
    arr = []
    while num:
        arr.append(num % 100)
        num //= 100
    arr += [0] * max(0, (3-len(arr)))
    version = '.'.join(map(str, arr[::-1]))

    return version

def parse_requirements(filename):
    with open(filename, "r") as f:
        lines = f.read().splitlines()

    requires = []

    for line in lines:
        if "http" in line:
            pkg_name_without_url = line.split('@')[0].strip()
            requires.append(pkg_name_without_url)
        else:
            requires.append(line)

    return requires

with open("README.md", "r") as f:
    long_description = f.read()
    m = re.findall( r"```mermaid.*?```", long_description, flags=re.DOTALL)
    long_description = long_description.replace(m[0], '![pipe demo](https://raw.githubusercontent.com/maokangkun/SigmaFlow/main/assets/demo_pipe.png)').replace(m[1], '![perf demo](https://raw.githubusercontent.com/maokangkun/SigmaFlow/main/assets/demo_perf.png)')

setuptools.setup(
    name=pkg_name.lower(),  # Replace with your own username
    version=get_new_version(),
    author="maokangkun",
    author_email="maokangkun@pjlab.prg.cn",
    description=f"{pkg_name} is a Python package designed to optimize the performance of task-flow related to LLMs or MLLMs",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url=f"https://github.com/maokangkun/{pkg_name}",
    packages=setuptools.find_packages(),
    install_requires=parse_requirements("requirements.txt"),
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires='>=3.10',
    zip_safe=False,
)
