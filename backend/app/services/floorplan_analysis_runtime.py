"""One bounded OCR process per drawing; native image buffers die with the worker."""
import json
import os
import signal
import subprocess
import sys

VERSION='orthogonal-area-13'


def analyze_isolated(data: bytes, exclusive_area: float, *, expanded=False,supply_area=None) -> dict:
    header=json.dumps({'exclusive_area':exclusive_area,'expanded':expanded,'supply_area':supply_area}).encode()+b'\n'
    env={**os.environ,'OMP_THREAD_LIMIT':'1','OPENBLAS_NUM_THREADS':'1','MALLOC_ARENA_MAX':'2'}
    worker=subprocess.Popen([sys.executable,'-m','app.services.floorplan_image_worker'],stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,start_new_session=os.name=='posix')
    try:
        output,_=worker.communicate(header+data,timeout=40)
    except subprocess.TimeoutExpired as exc:
        if os.name=='posix':os.killpg(worker.pid,signal.SIGKILL)
        else:worker.kill()
        worker.communicate()
        raise LookupError('drawing analysis deadline') from exc
    if worker.returncode or len(output)>2_000_000:raise LookupError('drawing analysis worker failed')
    result=json.loads(output)
    if not isinstance(result,dict) or result.get('version')!=VERSION:raise ValueError('drawing analysis result')
    return result
