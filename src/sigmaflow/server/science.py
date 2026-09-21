from fastapi import APIRouter, HTTPException, Header

class ScienceAPI:
    def __init__(self):
        self.router = router = APIRouter(prefix="/science")