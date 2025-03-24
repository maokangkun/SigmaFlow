import setuptools
# from sigmaflow import __version__

def parse_requirements(filename):
    with open(filename) as f:
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

requires = []
# with open("requirements.txt", "r") as f:
#     lines = f.read().splitlines()
#     requires = []

#     for line in lines:
#         if "http" in line:
#             pkg_name_without_url = line.split('@')[0].strip()
#             requires.append(pkg_name_without_url)
#         else:
#             requires.append(line)

setuptools.setup(
    name="sigmaflow",  # Replace with your own username
    version="0.0.1",
    author="maokangkun",
    author_email="maokangkun@pjlab.prg.cn",
    description="SigmaFlow is a Python package designed to optimize the performance of task-flow related to LLMs or MLLMs",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/maokangkun/SigmaFlow",
    packages=setuptools.find_packages(),
    install_requires=requires,
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires='>=3.10',
    zip_safe=False,
)
