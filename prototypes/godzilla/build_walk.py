"""Run with Blender 4.2 in background mode; never edits the input GLB."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


FPS = 30
CYCLE_FRAMES = 192
STANCE = 0.60
HEIGHT = 110.0
LEG_NAMES = {
    "L": ("bip_hip_l_138", "bip_knee_l_137", "bip_foot_l_136"),
    "R": ("bip_hip_r_155", "bip_knee_r_154", "bip_foot_r_153"),
}


def foot_path(phase: float, stride: float) -> tuple[float, float, float]:
    front, back = -stride * STANCE / 2, stride * STANCE / 2
    if phase < STANCE:
        return front + stride * phase, 0.0, 0.0
    u = (phase - STANCE) / (1 - STANCE)
    tangent = stride * (1 - STANCE)
    travel = (
        (2 * u**3 - 3 * u**2 + 1) * back
        + (u**3 - 2 * u**2 + u) * tangent
        + (-2 * u**3 + 3 * u**2) * front
        + (u**3 - u**2) * tangent
    )
    lift = 2.8 * math.sin(math.pi * u) ** 2
    pitch = math.radians(7) * math.sin(2 * math.pi * u)
    return travel, lift, pitch


def create_control(name: str, position: Vector) -> bpy.types.Object:
    control = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(control)
    control.location = position
    control.empty_display_type = "PLAIN_AXES"
    control.empty_display_size = 3
    control.rotation_mode = "QUATERNION"
    return control


def world_rotation(bone: bpy.types.PoseBone, axis: str, angle: float) -> Quaternion:
    rest = bone.bone.matrix_local.to_quaternion()
    direction = {"X": (1, 0, 0), "Y": (0, 1, 0), "Z": (0, 0, 1)}[axis]
    return rest.inverted() @ Quaternion(direction, angle) @ rest


def main() -> None:
    arguments = sys.argv[sys.argv.index("--") + 1 :]
    if len(arguments) != 2:
        raise ValueError("Expected input.glb and output-directory after --")
    source, output = Path(arguments[0]).resolve(), Path(arguments[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    blend = output / "Godzilla-Slow-Wade.blend"
    glb = output / "godzilla-walk.glb"
    report_file = output / "walk-validation.json"
    for path in [blend, glb, report_file]:
        if path.exists():
            raise FileExistsError(f"Refusing to overwrite {path}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(rig.data.bones) != 160:
        raise ValueError("The expected 160-bone source rig was not imported")
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = CYCLE_FRAMES + 1
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION"
        bone.ik_stretch = 0

    vertices = [obj.matrix_world @ v.co for obj in meshes for v in obj.data.vertices]
    source_height = max(v.z for v in vertices) - min(v.z for v in vertices)
    ground_distance = math.hypot(20, 40) * math.cos(math.radians(25.146))
    stride = ground_distance / 2 * source_height / HEIGHT
    pelvis = rig.pose.bones["bip_pelvis_158"]
    pelvis_basis = pelvis.bone.matrix_local.to_3x3().inverted()
    controls = {}
    pole_angles = {}
    for side, (hip_name, knee_name, foot_name) in LEG_NAMES.items():
        knee, foot = rig.pose.bones[knee_name], rig.pose.bones[foot_name]
        rest_foot = rig.matrix_world @ foot.matrix
        target = create_control(f"WalkFoot.{side}", rest_foot.translation)
        target.rotation_quaternion = rest_foot.to_quaternion()
        rest_knee = (rig.matrix_world @ knee.matrix).translation.copy()
        pole = create_control(f"WalkKneePole.{side}", rest_knee + Vector((0, -60, 0)))
        constraint = knee.constraints.new("IK")
        constraint.target = target
        constraint.pole_target = pole
        constraint.chain_count = 2
        constraint.use_stretch = False
        constraint.iterations = 128
        best_angle, best_error = 0.0, float("inf")
        for step in range(144):
            constraint.pole_angle = -math.pi + step * math.tau / 144
            bpy.context.view_layer.update()
            error = ((rig.matrix_world @ knee.matrix).translation - rest_knee).length
            if error < best_error:
                best_angle, best_error = constraint.pole_angle, error
        for step in range(-10, 11):
            constraint.pole_angle = best_angle + step * 0.002
            bpy.context.view_layer.update()
            error = ((rig.matrix_world @ knee.matrix).translation - rest_knee).length
            if error < best_error:
                best_angle, best_error = constraint.pole_angle, error
        constraint.pole_angle = best_angle
        pole_angles[side] = {"radians": best_angle, "rest_knee_error": best_error}
        rotation = foot.constraints.new("COPY_ROTATION")
        rotation.target = target
        rotation.owner_space = "WORLD"
        rotation.target_space = "WORLD"
        controls[side] = (target, rest_foot, foot)

    tail = [bone for bone in rig.pose.bones if bone.name.startswith("bip_tail")]
    spine = rig.pose.bones["bip_spine_1_115"]
    neck = rig.pose.bones["bip_neck_110"]
    arms = [rig.pose.bones["bip_upperarm_l_39"], rig.pose.bones["bip_upperarm_r_56"]]
    for frame in range(1, CYCLE_FRAMES + 2):
        scene.frame_set(frame)
        phase = (frame - 1) / CYCLE_FRAMES
        angle = math.tau * phase
        pelvis.location = pelvis_basis @ Vector((
            0.75 * math.sin(angle), 0, -0.24 * (1 - math.cos(2 * angle))
        ))
        pelvis.rotation_quaternion = world_rotation(pelvis, "Y", math.radians(0.65) * math.sin(angle))
        pelvis.keyframe_insert("location", frame=frame)
        pelvis.keyframe_insert("rotation_quaternion", frame=frame)
        spine.rotation_quaternion = world_rotation(spine, "Z", math.radians(0.8) * math.sin(angle))
        neck.rotation_quaternion = world_rotation(neck, "Y", -math.radians(0.45) * math.sin(angle))
        for bone in [spine, neck]:
            bone.keyframe_insert("rotation_quaternion", frame=frame)
        for index, bone in enumerate(tail):
            bone.rotation_quaternion = world_rotation(
                bone, "Z", math.radians(0.4) * math.sin(angle - index * 0.20)
            )
            bone.keyframe_insert("rotation_quaternion", frame=frame)
        for index, bone in enumerate(arms):
            bone.rotation_quaternion = world_rotation(
                bone, "X", math.radians(2.2) * math.sin(angle + index * math.pi)
            )
            bone.keyframe_insert("rotation_quaternion", frame=frame)
        for side, (target, rest, _) in controls.items():
            foot_phase = (phase + (0.5 if side == "R" else 0)) % 1
            forward, lift, pitch = foot_path(foot_phase, stride)
            target.location = rest.translation + Vector((0, forward, lift))
            target.rotation_quaternion = Quaternion((1, 0, 0), pitch) @ rest.to_quaternion()
            target.keyframe_insert("location", frame=frame)
            target.keyframe_insert("rotation_quaternion", frame=frame)

    for action in bpy.data.actions:
        for curve in action.fcurves:
            for key in curve.keyframe_points:
                key.interpolation = "LINEAR"

    max_ankle_error = 0.0
    max_stance_drift = 0.0
    planted = {}
    first_matrices = {}
    last_matrices = {}
    for frame in range(1, CYCLE_FRAMES + 2):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        phase = (frame - 1) / CYCLE_FRAMES
        root_motion = Vector((0, -stride * phase, 0))
        for side, (target, _, foot) in controls.items():
            point = (rig.matrix_world @ foot.matrix).translation
            max_ankle_error = max(max_ankle_error, (point - target.location).length)
            foot_phase = (phase + (0.5 if side == "R" else 0)) % 1
            if foot_phase < STANCE and frame <= CYCLE_FRAMES:
                world = point + root_motion
                if side in planted:
                    max_stance_drift = max(max_stance_drift, (world - planted[side]).length)
                else:
                    planted[side] = world.copy()
            else:
                planted.pop(side, None)
        if frame in [1, CYCLE_FRAMES + 1]:
            matrices = {bone.name: bone.matrix.copy() for bone in rig.pose.bones}
            if frame == 1:
                first_matrices = matrices
            else:
                last_matrices = matrices
    loop_error = max(
        abs(first_matrices[name][r][c] - last_matrices[name][r][c])
        for name in first_matrices for r in range(4) for c in range(4)
    )
    if max_ankle_error > 0.03 or max_stance_drift > 0.03 or loop_error > 0.01:
        raise ValueError(
            f"Gait validation failed: ankle={max_ankle_error}, stance={max_stance_drift}, loop={loop_error}"
        )

    scene["model_author"] = "Draco (https://sketchfab.com/Draco120)"
    scene["model_license"] = "CC BY 4.0"
    scene["modifications"] = "Slow wading gait, two-bone IK and planted stance, restrained weight transfer"
    rig["cycle_duration_s"] = CYCLE_FRAMES / FPS
    rig["cycle_stride_source_units"] = stride
    rig["source_height"] = source_height

    scene.frame_set(1)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                region = area.spaces.active.region_3d
                target = Vector((0, 0, 32))
                eye = Vector((140, -185, 95))
                region.view_location = target
                region.view_distance = (eye - target).length
                region.view_rotation = (target - eye).to_track_quat("-Z", "Y")
                region.view_perspective = "PERSP"
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.nla.bake(
        frame_start=1, frame_end=CYCLE_FRAMES + 1, step=1,
        only_selected=False, visual_keying=True, clear_constraints=True,
        use_current_action=False, bake_types={"POSE"}
    )
    rig.animation_data.action.name = "Slow_Wade_6_4s"
    baked = rig.animation_data.action
    for action in list(bpy.data.actions):
        if action != baked:
            bpy.data.actions.remove(action)
    for curve in baked.fcurves:
        for key in curve.keyframe_points:
            key.co.x -= 1
            key.handle_left.x -= 1
            key.handle_right.x -= 1
    scene.frame_start = 0
    scene.frame_end = CYCLE_FRAMES
    scene.frame_set(0)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [rig, *meshes]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(glb), export_format="GLB", use_selection=True,
        export_animations=True, export_frame_range=True, export_force_sampling=True,
        export_skins=True, export_def_bones=True, export_animation_mode="ACTIONS",
        export_extras=True, export_cameras=False, export_lights=False
    )
    report = {
        "blender": bpy.app.version_string,
        "input": str(source), "blend": str(blend), "glb": str(glb),
        "bones": len(rig.data.bones), "duration_s": CYCLE_FRAMES / FPS,
        "fps": FPS, "source_height": source_height, "stride_source_units": stride,
        "max_ankle_target_error": max_ankle_error, "max_stance_drift": max_stance_drift,
        "loop_matrix_error": loop_error, "pole_angles": pole_angles,
    }
    report_file.write_text(json.dumps(report, indent=2))
    print("WALK_VALIDATION " + json.dumps(report))


if __name__ == "__main__":
    main()
