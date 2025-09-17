import { GetObjectCommand, ObjectCannedACL, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { File as MulterFile } from "multer";
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class FileSystemService {
    private s3: S3Client;
    constructor(private configService: ConfigService) {
        try {
            this.s3 = new S3Client({
                region: this.configService.get<string>('s3.region') ?? 'us-east-1',
                endpoint: this.configService.get<string>('s3.endpoint'),
                forcePathStyle: true,
                credentials: {
                    accessKeyId: this.configService.get<string>('s3.accessKeyId') ?? '',
                    secretAccessKey: this.configService.get<string>('s3.secretAccessKey') ?? '',
                },
            });
            console.log('🔥 S3 Client initialized');
        } catch (error) {
            console.error('❌ S3 Client initialization error:', error);
        }
    }


    async uploadSingleFile(file: MulterFile) {
        // Implement your file upload logic here using this.s3
        const timestamp = new Date().getTime();
        const fileExtension = file.originalname.split('.').pop();
        const fileNameWithoutExt = file.originalname.replace(/\.[^/.]+$/, "");
        const fileName = `${fileNameWithoutExt}_${timestamp}.${fileExtension}`;
        const uploadParams = {
            Bucket: this.configService.get<string>('s3.bucketName'),
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            ACL: ObjectCannedACL.public_read,
        };
        try {
            // You can use this.s3.send(new PutObjectCommand(uploadParams)) to upload the file
            await this.s3.send(new PutObjectCommand(uploadParams));
            return {
                url: `${this.configService.get<string>('s3.endpoint')}/${this.configService.get<string>('s3.bucketName')}/${fileName}`,
                message: 'File uploaded successfully',
            };
        } catch (error) {
            return {
                url: '',
                message: 'File upload failed ' + error.message,
            };
        }
    }

    async getPresignedUrl(fileName: string) {
        const command = new GetObjectCommand({
            Bucket: this.configService.get<string>('s3.bucketName'),
            Key: fileName,
        });
        return {
            url: await getSignedUrl(this.s3, command, { expiresIn: 3600 }),
            message: 'Presigned URL generated successfully',
        };
    }

}