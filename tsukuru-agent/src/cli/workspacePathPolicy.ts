import fs from 'fs';
import path from 'path';
import { AgentRequest } from '../core/schema';
import { ErrorCodes, OperationError } from '../core/types';

export function isWithinPath(parent: string, child: string): boolean {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export function pathsOverlap(left: string, right: string): boolean {
    return isWithinPath(left, right) || isWithinPath(right, left);
}

export function resolveContainerOutputPath(request: AgentRequest, sourceRoot: string): string {
    const source = path.resolve(sourceRoot);
    const output = path.resolve(
        request.outputPath ?? path.join(path.dirname(source), path.basename(source) + '_tsukuru'),
    );
    if (pathsOverlap(source, output)) {
        throw new OperationError(
            ErrorCodes.OUTPUT_CONFLICT,
            '컨테이너 출력은 원본 경로 바깥이어야 합니다',
            { outputPath: output },
        );
    }
    if (fs.existsSync(output)) {
        if (request.options.force !== true) {
            throw new OperationError(
                ErrorCodes.OUTPUT_CONFLICT,
                '출력 경로가 이미 존재합니다',
                { outputPath: output },
            );
        }
    }
    return output;
}
