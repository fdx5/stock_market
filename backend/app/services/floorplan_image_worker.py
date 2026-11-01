"""Private stdin/stdout worker. No app startup, database, or network access."""
import json
import sys


def main():
    options=json.loads(sys.stdin.buffer.readline(2048))
    data=sys.stdin.buffer.read(8*1024*1024+1)
    if len(data)>8*1024*1024:raise ValueError('drawing size')
    from app.services.floorplan_image_analysis import analyze_image
    result=analyze_image(data,**options)
    sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False,allow_nan=False).encode('utf8'))


if __name__=='__main__':main()
