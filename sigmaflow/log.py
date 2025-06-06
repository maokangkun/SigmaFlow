import os
import logging
import datetime
from pathlib import Path
from rich.console import Console
from rich.logging import RichHandler
from logging.handlers import RotatingFileHandler

def beijing(sec, what):
    beijing_time = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    return beijing_time.timetuple()

SAVE_LOG = bool(int(os.getenv('SAVE_LOG', 0)))
LOG_DIR = os.getenv('LOGGING_DIR', 'logs')
LOG_LEVEL = os.getenv('LOGGING_LEVEL', 'NOTSET')
MAXBYTES = 10000000 # ~10M
LOGFORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
LOGFORMAT_RICH = '%(message)s'
log_dir = Path(LOG_DIR)

rh = RichHandler(console=Console(stderr=True))
rh.setFormatter(logging.Formatter(LOGFORMAT_RICH))
logging.Formatter.converter = beijing
handlers = [rh]

if SAVE_LOG:
    log_dir.mkdir(exist_ok=True, parents=True)
    log_file = log_dir / f"{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
    handlers.append(RotatingFileHandler(log_file, maxBytes=MAXBYTES))

logging.basicConfig(level=LOG_LEVEL, format=LOGFORMAT, datefmt="[%y-%m-%d %H:%M:%S]", handlers=handlers)
log = logging.getLogger("SigmaFlow")

def _banner_print(text):
    n = len(text)
    t = '\n' + '-'*(4+n) + '\n| ' + text + ' |\n' + '-'*(4+n)
    log.debug(t)

log.banner = _banner_print