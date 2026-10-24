import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class PaypalService {


    constructor(private readonly httpService: HttpService) { }


}
