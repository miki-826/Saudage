"use client";
import { useEffect, useRef } from "react";
import type { VisualSignals } from "@/lib/game/engine";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
export function CameraTracker({
  onSignals,
  onError,
}: {
  onSignals: (s: VisualSignals | null) => void;
  onError: (s: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false,
      stream: MediaStream | undefined,
      model: FaceLandmarker | undefined,
      frame = 0,
      last = 0,
      previousSmile = 0,
      previousX = 0.5;
    async function init() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const { FaceLandmarker, FilesetResolver } =
          await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks("/models/wasm");
        model = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/face_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        });
        if (cancelled) {
          model.close();
          return;
        }
        const element = video.current;
        if (!element) return;
        element.srcObject = stream;
        await element.play();
        function tick(now: number) {
          if (cancelled) return;
          if (now - last > 150 && element && element.readyState >= 2 && model) {
            last = now;
            const result = model.detectForVideo(element, now);
            const categories = result.faceBlendshapes[0]?.categories;
            const point = result.faceLandmarks[0]?.[1];
            if (categories && point) {
              const score = (name: string) =>
                categories.find((c) => c.categoryName === name)?.score ?? 0;
              const smile =
                (score("mouthSmileLeft") + score("mouthSmileRight")) / 2;
              onSignals({
                smileDelta: smile - previousSmile,
                headMovement: Math.min(1, Math.abs(point.x - previousX) * 8),
                eyeMovement:
                  (score("eyeLookInLeft") + score("eyeLookInRight")) / 2,
                mouthMovement: score("jawOpen"),
              });
              previousSmile = smile;
              previousX = point.x;
            } else onSignals(null);
          }
          frame = requestAnimationFrame(tick);
        }
        frame = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) {
          onError(
            "カメラを利用できませんでした。カメラなしでそのまま遊べます。",
          );
          onSignals(null);
        }
        stream?.getTracks().forEach((t) => t.stop());
        model?.close();
      }
    }
    void init();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      model?.close();
      onSignals(null);
    };
  }, [onSignals, onError]);
  return (
    <div className="camera-preview">
      <video
        ref={video}
        muted
        playsInline
        aria-label="端末内で処理するカメラ映像"
      />
      <span>端末内で解析中</span>
    </div>
  );
}
